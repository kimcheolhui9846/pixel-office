import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";

import { CLAUDE_HOOK_EVENTS } from "@pixel-office/core";

import { type Check, type DoctorIo, formatChecks, runDoctor } from "../src/doctor.js";
import { addOurHooks, codexWrapperScript, hookStatus, type HookTarget } from "../src/settings.js";

let root: string;
let n = 0;

before(() => {
  root = mkdtempSync(join(tmpdir(), "pixel-office-doctor-"));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

const NODE = "/usr/bin/node";
const TOKEN = "ab".repeat(32);

/** A fresh home folder with a built hook.js; Linux paths so no Codex wrapper is involved. */
function setup(over: Partial<DoctorIo> = {}): { io: DoctorIo; home: string; target: HookTarget } {
  n += 1;
  const home = join(root, `home${n}`);
  const hookPath = join(root, `repo${n}`, "packages", "cli", "dist", "src", "hook.js");
  mkdirSync(dirname(hookPath), { recursive: true });
  writeFileSync(hookPath, "// fake\n");
  mkdirSync(home, { recursive: true });
  const io: DoctorIo = {
    env: {},
    homedir: () => home,
    out: () => {},
    err: () => {},
    interactive: false,
    ask: async () => "",
    nodePath: NODE,
    hookPath,
    isWsl: () => false,
    windowsProfile: () => null,
    toWslPath: () => null,
    now: () => new Date(0),
    platform: "linux",
    cwd: join(home, "work", "repo"),
    nodeVersion: "v22.1.0",
    uiBuilt: true,
    health: async () => true,
    ...over,
  };
  return { io, home, target: { nodePath: NODE, hookPath } };
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const find = (checks: Check[], title: string) => {
  const c = checks.find((x) => x.title === title);
  assert.ok(c, `no check "${title}" in ${checks.map((x) => x.title).join(", ")}`);
  return c;
};

describe("hookStatus", () => {
  const target: HookTarget = { nodePath: NODE, hookPath: "/repo/packages/cli/dist/src/hook.js" };

  test("nothing, everything, a moved repo, a new event", () => {
    assert.deepEqual(hookStatus(null, target), { total: CLAUDE_HOOK_EVENTS.length, current: 0, missing: [...CLAUDE_HOOK_EVENTS] });
    const full = addOurHooks(null, target).after;
    assert.equal(hookStatus(full, target).current, CLAUDE_HOOK_EVENTS.length);
    const moved = { ...target, hookPath: "/elsewhere/packages/cli/dist/src/hook.js" };
    assert.deepEqual(hookStatus(full, moved), { total: CLAUDE_HOOK_EVENTS.length, current: 0, missing: [] });
    const data = JSON.parse(full) as { hooks: Record<string, unknown> };
    delete data.hooks.SubagentStart;
    assert.deepEqual(hookStatus(JSON.stringify(data), target).missing, ["SubagentStart"]);
  });

  test("a reformatted file still counts as current", () => {
    const compact = JSON.stringify(JSON.parse(addOurHooks(null, target).after));
    assert.equal(hookStatus(compact, target).current, CLAUDE_HOOK_EVENTS.length);
  });
});

describe("runDoctor", () => {
  test("a fresh machine: no server, no hooks, no Codex", async () => {
    const { io } = setup();
    const checks = await runDoctor({}, io);
    assert.equal(find(checks, "Node.js").level, "ok");
    assert.equal(find(checks, "서버").level, "info");
    const claude = find(checks, "Claude Code 훅");
    assert.equal(claude.level, "fail");
    assert.match(claude.detail, /^~[\\/]\.claude[\\/]settings\.json에 Pixel Office 훅이 없습니다/);
    assert.match(claude.detail, /pixel-office init --agent claude/);
    assert.equal(find(checks, "Codex 훅").level, "info");
    assert.equal(formatChecks(checks).code, 1);
  });

  test("everything in place exits 0; the token is never shown", async () => {
    const { io, home, target } = setup();
    write(join(home, ".claude", "settings.json"), addOurHooks(null, target).after);
    write(join(home, ".codex", "hooks.json"), addOurHooks(null, target, "codex").after);
    write(join(home, ".pixel-office", "server.json"), JSON.stringify({ port: 47999, token: TOKEN, pid: 1, startedAt: "2026-11-09T00:00:00Z" }));
    const checks = await runDoctor({}, io);
    assert.deepEqual(
      checks.filter((c) => c.level === "fail" || c.level === "warn"),
      [],
    );
    assert.equal(find(checks, "서버").level, "ok");
    assert.match(find(checks, "작업 폴더").detail, /47999\/\?workspace=/);
    const { text, code } = formatChecks(checks);
    assert.equal(code, 0);
    assert.match(text, /모두 정상입니다/);
    assert.ok(!text.includes(TOKEN));
  });

  test("a stale server record and old hooks are warnings, not failures", async () => {
    const { io, home, target } = setup({ health: async () => false });
    const old = JSON.parse(addOurHooks(null, target).after) as { hooks: Record<string, unknown> };
    delete old.hooks.SubagentStop;
    write(join(home, ".claude", "settings.json"), JSON.stringify(old));
    write(join(home, ".pixel-office", "server.json"), JSON.stringify({ port: 47999, token: TOKEN, pid: 1, startedAt: "2026-11-09T00:00:00Z" }));
    const checks = await runDoctor({}, io);
    assert.equal(find(checks, "서버").level, "warn");
    const claude = find(checks, "Claude Code 훅");
    assert.equal(claude.level, "warn");
    assert.match(claude.detail, /빠진 이벤트: SubagentStop/);
    assert.equal(formatChecks(checks).code, 0);
  });

  test("inside Orca the advice is a restart, and the copy Orca uses is checked", async () => {
    const { io, home, target } = setup();
    const profile = join(home, "orca-profile");
    write(join(profile, "settings.json"), "{}");
    write(join(home, ".claude", "settings.json"), addOurHooks(null, target).after);
    io.env = { CLAUDE_CONFIG_DIR: profile, ORCA_WORKTREE_ID: `repo1::${join(home, "work", "repo")}` };
    const checks = await runDoctor({}, io);
    const claude = find(checks, "Claude Code 훅");
    assert.equal(claude.level, "fail");
    assert.match(claude.detail, /orca-profile/);
    assert.match(claude.detail, /Orca를 다시 시작하세요/);
    assert.match(find(checks, "Orca").detail, /설정 사본/);
  });

  test("broken settings, no build, old node", async () => {
    const { io, home } = setup({ uiBuilt: false, nodeVersion: "v18.19.0" });
    write(join(home, ".claude", "settings.json"), "{ not json");
    const checks = await runDoctor({}, io);
    assert.equal(find(checks, "Node.js").level, "fail");
    assert.equal(find(checks, "화면 파일").level, "fail");
    assert.match(find(checks, "Claude Code 훅").detail, /JSON 형식이 아닙니다/);
  });

  test("no hook.js means the repo is not built", async () => {
    const { io } = setup();
    io.hookPath = join(root, "missing", "hook.js");
    const checks = await runDoctor({}, io);
    assert.equal(find(checks, "훅").level, "fail");
  });

  test("Windows: the Codex wrapper is checked against this build", { skip: process.platform !== "win32" }, async () => {
    const { io, home, target } = setup({ platform: "win32" });
    const wrapper = join(home, ".pixel-office", "pixel-office-codex-hook.cmd");
    const winTarget = { ...target, windows: true, codexWrapper: wrapper };
    write(join(home, ".claude", "settings.json"), addOurHooks(null, winTarget).after);
    write(join(home, ".codex", "hooks.json"), addOurHooks(null, winTarget, "codex").after);
    let checks = await runDoctor({}, io);
    assert.equal(find(checks, "Codex 훅").level, "ok");
    assert.equal(find(checks, "Codex 훅 래퍼").level, "warn");
    write(wrapper, codexWrapperScript(winTarget));
    checks = await runDoctor({}, io);
    assert.equal(find(checks, "Codex 훅 래퍼").level, "ok");
    assert.equal(readFileSync(wrapper, "utf8"), codexWrapperScript(winTarget), "doctor writes nothing");
  });
});
