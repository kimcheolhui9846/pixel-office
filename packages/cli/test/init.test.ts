import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { CLAUDE_HOOK_EVENTS } from "@pixel-office/core";

import { unifiedDiff } from "../src/diff.js";
import { claudeSettingsPath, detectWsl, EXIT_NEEDS_CONFIRMATION, type InitIo, type InitOptions, runInit } from "../src/init.js";
import { addOurHooks, isOurHook, ourHook, removeOurHooks } from "../src/settings.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), "pixel-office-init-"));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Settings as other tools leave them: Orca and a skill kit hooks, a status line, permissions. */
const FIXTURE = {
  $schema: "https://json.schemastore.org/claude-code-settings.json",
  permissions: { allow: ["Bash(npm test:*)", "Read(//tmp/**)"], deny: ["Read(./.env)"] },
  hooks: {
    PreToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: "~/.claude/skill-kit/guard.sh", timeout: 10 }] },
    ],
    Stop: [{ hooks: [{ type: "command", command: "/usr/local/bin/orca-hook claude stop" }] }],
    SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] }],
  },
  statusLine: { type: "command", command: "~/.claude/statusline.sh", padding: 0 },
  model: "opus",
};
const FIXTURE_TEXT = JSON.stringify(FIXTURE, null, 2) + "\n";
const NO_HOOKS_TEXT = JSON.stringify({ model: "sonnet", statusLine: { type: "command", command: "x" } }, null, 2) + "\n";

const NODE = "C:\\Program Files\\nodejs\\node.exe";

/** A fake repo checkout with a hook.js at the real relative path. */
function repo(name: string): string {
  const hook = join(root, name, "packages", "cli", "dist", "src", "hook.js");
  mkdirSync(dirname(hook), { recursive: true });
  writeFileSync(hook, "// fake\n");
  return hook;
}

interface Fake {
  io: InitIo;
  out: string[];
  err: string[];
  home: string;
  settings: string;
  poHome: string;
}

let counter = 0;
function fake(overrides: Partial<InitIo> = {}, settingsText?: string): Fake {
  counter += 1;
  const home = join(root, `home-${counter}`);
  mkdirSync(home, { recursive: true });
  const poHome = join(home, "po");
  const settings = join(home, ".claude", "settings.json");
  if (settingsText !== undefined) {
    mkdirSync(dirname(settings), { recursive: true });
    writeFileSync(settings, settingsText);
  }
  const out: string[] = [];
  const err: string[] = [];
  const io: InitIo = {
    env: { PIXEL_OFFICE_HOME: poHome },
    homedir: () => home,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    interactive: false,
    ask: async () => "n",
    nodePath: NODE,
    hookPath: repo("repo-a"),
    isWsl: () => false,
    windowsProfile: () => null,
    toWslPath: () => null,
    now: () => new Date("2026-11-09T01:02:03.456Z"),
    ...overrides,
  };
  return { io, out, err, home, settings, poHome };
}

const YES: InitOptions = { dryRun: false, yes: true };
const read = (path: string) => readFileSync(path, "utf8");

function backups(poHome: string): string[] {
  const dir = join(poHome, "backups");
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe("settings merge", () => {
  test("keeps foreign hooks and every other key in order", () => {
    const hook = repo("repo-a");
    const { after: text } = addOurHooks(FIXTURE_TEXT, { nodePath: NODE, hookPath: hook });
    const data = JSON.parse(text) as Record<string, unknown> & { hooks: Record<string, unknown[]> };
    assert.deepEqual(Object.keys(data), ["$schema", "permissions", "hooks", "statusLine", "model"]);
    assert.deepEqual(data.permissions, FIXTURE.permissions);
    assert.deepEqual(data.statusLine, FIXTURE.statusLine);
    // foreign groups first and untouched, ours appended
    assert.deepEqual(data.hooks.PreToolUse?.[0], FIXTURE.hooks.PreToolUse[0]);
    assert.deepEqual(data.hooks.Stop?.[0], FIXTURE.hooks.Stop[0]);
    assert.deepEqual(data.hooks.SessionStart, FIXTURE.hooks.SessionStart);
    for (const event of CLAUDE_HOOK_EVENTS) {
      const groups = data.hooks[event] ?? [];
      assert.equal(groups.filter((g) => (g as { hooks: unknown[] }).hooks.some(isOurHook)).length, 1, event);
      assert.deepEqual(groups[groups.length - 1], { hooks: [ourHook({ nodePath: NODE, hookPath: hook })] });
    }
    // 2-space indent and the trailing newline
    assert.match(text, /^\{\n {2}"\$schema"/);
    assert.ok(text.endsWith("}\n"));
  });

  test("our handler is exec form with async and a timeout in seconds", () => {
    const handler = ourHook({ nodePath: NODE, hookPath: "D:\\a b\\packages\\cli\\dist\\src\\hook.js" });
    assert.deepEqual(handler, {
      type: "command",
      command: NODE,
      args: ["D:\\a b\\packages\\cli\\dist\\src\\hook.js", "claude"],
      async: true,
      timeout: 3,
    });
  });

  test("isOurHook recognises only our handlers", () => {
    assert.equal(isOurHook(ourHook({ nodePath: "/usr/bin/node", hookPath: "/r/packages/cli/dist/src/hook.js" })), true);
    assert.equal(
      isOurHook({ type: "command", command: '"/usr/bin/node" "/r/node_modules/@pixel-office/cli/dist/src/hook.js" claude' }),
      true,
    );
    assert.equal(isOurHook({ type: "command", command: "C:/n/node.exe C:/r/packages/cli/dist/src/hook.js claude" }), true);
    assert.equal(isOurHook({ type: "command", command: "/usr/local/bin/orca-hook claude stop" }), false);
    assert.equal(isOurHook({ type: "command", command: "node", args: ["/other/hook.js", "claude"] }), false);
    assert.equal(isOurHook({ type: "command", command: "node", args: ["/r/cli/dist/src/hook.js", "codex"] }), false);
    assert.equal(isOurHook({ type: "http", url: "http://x/cli/dist/src/hook.js claude" }), false);
    assert.equal(isOurHook(null), false);
  });

  test("a group shared with a foreign handler keeps the foreign one on uninit", () => {
    const ours = ourHook({ nodePath: NODE, hookPath: "/r/packages/cli/dist/src/hook.js" });
    const foreign = { type: "command", command: "echo keep" };
    const text = JSON.stringify({ hooks: { Stop: [{ hooks: [foreign, ours] }] } }, null, 2) + "\n";
    const result = removeOurHooks(text);
    assert.equal(result.removed, 1);
    assert.deepEqual(JSON.parse(result.after), { hooks: { Stop: [{ hooks: [foreign] }] } });
  });

  test("CRLF line ends and a 4-space indent survive init and uninit", () => {
    const original = JSON.stringify(FIXTURE, null, 4).replace(/\n/g, "\r\n") + "\r\n";
    const added = addOurHooks(original, { nodePath: NODE, hookPath: "/r/packages/cli/dist/src/hook.js" }).after;
    assert.match(added, /^\{\r\n {4}"\$schema"/);
    assert.equal(removeOurHooks(added).after, original);
  });

  test("unusable settings are refused", () => {
    const target = { nodePath: NODE, hookPath: "/r/packages/cli/dist/src/hook.js" };
    assert.throws(() => addOurHooks("{ invalid", target), /JSON/);
    assert.throws(() => addOurHooks("[]", target), /객체/);
    assert.throws(() => addOurHooks('{"hooks": []}', target), /hooks/);
    assert.throws(() => addOurHooks('{"hooks": {"Stop": {}}}', target), /hooks\.Stop/);
  });
});

describe("init and uninit", () => {
  test("init writes, backs up the original byte for byte and prints the diff", async () => {
    const f = fake({}, FIXTURE_TEXT);
    assert.equal(await runInit("init", YES, f.io), 0, f.err.join("\n"));
    const text = read(f.settings);
    assert.notEqual(text, FIXTURE_TEXT);
    const stamps = backups(f.poHome);
    assert.deepEqual(stamps, ["2026-11-09T01-02-03-456Z"]);
    const backup = join(f.poHome, "backups", stamps[0] ?? "", "claude-settings.json");
    assert.equal(read(backup), FIXTURE_TEXT);
    const printed = f.out.join("\n");
    assert.match(printed, /^\+\s+"UserPromptSubmit": \[/m);
    assert.match(printed, /^--- .*settings\.json \(현재\)$/m);
    assert.ok(printed.includes(backup));
    // no temp files left next to the settings
    assert.deepEqual(readdirSync(dirname(f.settings)), ["settings.json"]);
  });

  test("init is idempotent: a second run changes nothing and makes no backup", async () => {
    const f = fake({}, FIXTURE_TEXT);
    assert.equal(await runInit("init", YES, f.io), 0);
    const once = read(f.settings);
    f.io.now = () => new Date("2026-11-09T05:00:00.000Z");
    assert.equal(await runInit("init", YES, f.io), 0);
    assert.equal(read(f.settings), once);
    assert.equal(backups(f.poHome).length, 1);
    assert.match(f.out.join("\n"), /이미 들어 있습니다/);
  });

  test("init then uninit restores the original byte for byte", async () => {
    for (const original of [FIXTURE_TEXT, NO_HOOKS_TEXT]) {
      const f = fake({}, original);
      assert.equal(await runInit("init", YES, f.io), 0);
      f.io.now = () => new Date("2026-11-09T06:00:00.000Z");
      assert.equal(await runInit("uninit", YES, f.io), 0, f.err.join("\n"));
      assert.equal(read(f.settings), original);
      assert.equal(backups(f.poHome).length, 2);
    }
  });

  test("uninit with nothing of ours changes nothing", async () => {
    const f = fake({}, FIXTURE_TEXT);
    assert.equal(await runInit("uninit", YES, f.io), 0);
    assert.equal(read(f.settings), FIXTURE_TEXT);
    assert.equal(backups(f.poHome).length, 0);
    const missing = fake();
    assert.equal(await runInit("uninit", YES, missing.io), 0);
    assert.equal(existsSync(missing.settings), false);
  });

  test("a missing settings file is created with only our hooks, without a backup", async () => {
    const f = fake();
    assert.equal(await runInit("init", YES, f.io), 0);
    const data = JSON.parse(read(f.settings)) as { hooks: Record<string, unknown> };
    assert.deepEqual(Object.keys(data), ["hooks"]);
    assert.deepEqual(Object.keys(data.hooks), [...CLAUDE_HOOK_EVENTS]);
    assert.equal(backups(f.poHome).length, 0);
  });

  test("invalid JSON is refused and left untouched", async () => {
    const broken = '{\n  "model": "opus",\n  // a comment\n}\n';
    const f = fake({}, broken);
    assert.equal(await runInit("init", YES, f.io), 1);
    assert.equal(read(f.settings), broken);
    assert.match(f.err.join("\n"), /이해할 수 없습니다/);
    assert.equal(existsSync(f.poHome), false);
    assert.equal(await runInit("uninit", YES, f.io), 1);
    assert.equal(read(f.settings), broken);
  });

  test("without --yes and without a terminal: exit 64 and nothing written", async () => {
    const f = fake({}, FIXTURE_TEXT);
    assert.equal(await runInit("init", { dryRun: false, yes: false }, f.io), EXIT_NEEDS_CONFIRMATION);
    assert.equal(read(f.settings), FIXTURE_TEXT);
    assert.equal(existsSync(f.poHome), false);
  });

  test("on a terminal it asks; y applies, anything else cancels", async () => {
    const asked: string[] = [];
    const no = fake({ interactive: true, ask: async (q) => (asked.push(q), "") }, FIXTURE_TEXT);
    assert.equal(await runInit("init", { dryRun: false, yes: false }, no.io), 1);
    assert.equal(read(no.settings), FIXTURE_TEXT);
    assert.deepEqual(asked, ["적용할까요? (y/N) "]);
    const yes = fake({ interactive: true, ask: async () => "Y" }, FIXTURE_TEXT);
    assert.equal(await runInit("init", { dryRun: false, yes: false }, yes.io), 0);
    assert.notEqual(read(yes.settings), FIXTURE_TEXT);
  });

  test("--dry-run prints the diff and writes nothing", async () => {
    const f = fake({}, FIXTURE_TEXT);
    assert.equal(await runInit("init", { dryRun: true, yes: false }, f.io), 0);
    assert.equal(read(f.settings), FIXTURE_TEXT);
    assert.equal(existsSync(f.poHome), false);
    assert.match(f.out.join("\n"), /^\+/m);
    assert.match(f.out.join("\n"), /--dry-run/);
    const missing = fake();
    assert.equal(await runInit("init", { dryRun: true, yes: true }, missing.io), 0);
    assert.equal(existsSync(missing.settings), false);
  });

  test("re-running after the repo moved replaces the old entries in place", async () => {
    const f = fake({}, FIXTURE_TEXT);
    assert.equal(await runInit("init", YES, f.io), 0);
    // another tool appends after ours
    const data = JSON.parse(read(f.settings)) as { hooks: Record<string, unknown[]> };
    data.hooks.Stop?.push({ hooks: [{ type: "command", command: "later-tool" }] });
    writeFileSync(f.settings, JSON.stringify(data, null, 2) + "\n");

    const moved = repo("repo-moved");
    f.io.hookPath = moved;
    f.io.now = () => new Date("2026-11-09T07:00:00.000Z");
    assert.equal(await runInit("init", YES, f.io), 0);
    const text = read(f.settings);
    assert.ok(!text.includes("repo-a"), "old path gone");
    const after = JSON.parse(text) as { hooks: Record<string, Array<{ hooks: unknown[] }>> };
    for (const event of CLAUDE_HOOK_EVENTS) {
      const ours = (after.hooks[event] ?? []).flatMap((g) => g.hooks).filter(isOurHook);
      assert.equal(ours.length, 1, event);
      assert.deepEqual((ours[0] as { args: string[] }).args, [moved, "claude"]);
    }
    const stop = after.hooks.Stop ?? [];
    assert.deepEqual(
      stop.map((g) => JSON.stringify(g).includes("hook.js") ? "ours" : (g.hooks[0] as { command: string }).command),
      ["/usr/local/bin/orca-hook claude stop", "ours", "later-tool"],
    );
  });

  test("CLAUDE_CONFIG_DIR relocates the settings file", async () => {
    const f = fake();
    const configDir = join(f.home, "alt-claude");
    f.io.env = { ...f.io.env, CLAUDE_CONFIG_DIR: configDir };
    assert.equal(await runInit("init", YES, f.io), 0);
    assert.ok(existsSync(join(configDir, "settings.json")));
    assert.equal(existsSync(f.settings), false);
    assert.equal(claudeSettingsPath({}, "/h"), join("/h", ".claude", "settings.json"));
  });

  test("a missing hook.js (not built) fails clearly", async () => {
    const f = fake({ hookPath: join(root, "nowhere", "hook.js") }, FIXTURE_TEXT);
    assert.equal(await runInit("init", YES, f.io), 1);
    assert.match(f.err.join("\n"), /npm run build/);
    assert.equal(read(f.settings), FIXTURE_TEXT);
  });
});

describe("init inside WSL (injected detector)", () => {
  test("the command sets PIXEL_OFFICE_HOME to the Windows .pixel-office folder", async () => {
    const f = fake({ isWsl: () => true, windowsProfile: () => "/mnt/c/Users/tester", nodePath: "/usr/bin/node" });
    assert.equal(await runInit("init", YES, f.io), 0, f.err.join("\n"));
    const data = JSON.parse(read(f.settings)) as { hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> };
    const handler = data.hooks.PreToolUse?.[0]?.hooks[0];
    assert.equal(handler?.command, "/usr/bin/env");
    assert.deepEqual(handler?.args, [
      "PIXEL_OFFICE_HOME=/mnt/c/Users/tester/.pixel-office",
      "/usr/bin/node",
      f.io.hookPath,
      "claude",
    ]);
    assert.equal(isOurHook(handler), true);
    assert.match(f.out.join("\n"), /PIXEL_OFFICE_HOME=\/mnt\/c\/Users\/tester\/\.pixel-office/);
  });

  test("--windows-home overrides the detection, as a WSL or a Windows path", async () => {
    const detected: string[] = [];
    const f = fake({
      isWsl: () => true,
      windowsProfile: () => (detected.push("x"), "/mnt/c/Users/wrong"),
      toWslPath: (p) => (p === "D:\\Users\\me" ? "/mnt/d/Users/me" : null),
    });
    assert.equal(await runInit("init", { ...YES, windowsHome: "/mnt/e/Users/given/" }, f.io), 0);
    assert.match(read(f.settings), /PIXEL_OFFICE_HOME=\/mnt\/e\/Users\/given\/\.pixel-office"/);
    f.io.now = () => new Date("2026-11-09T08:00:00.000Z");
    assert.equal(await runInit("init", { ...YES, windowsHome: "D:\\Users\\me" }, f.io), 0);
    const text = read(f.settings);
    assert.match(text, /PIXEL_OFFICE_HOME=\/mnt\/d\/Users\/me\/\.pixel-office"/);
    assert.doesNotMatch(text, /given/);
    assert.equal(detected.length, 0);
  });

  test("no Windows profile found: a clear failure and nothing written", async () => {
    const f = fake({ isWsl: () => true, windowsProfile: () => null }, FIXTURE_TEXT);
    assert.equal(await runInit("init", YES, f.io), 1);
    assert.match(f.err.join("\n"), /Windows 사용자 폴더를 찾지 못했습니다/);
    assert.match(f.err.join("\n"), /--windows-home/);
    assert.equal(read(f.settings), FIXTURE_TEXT);
  });

  test("--windows-home outside WSL is a usage mistake", async () => {
    const f = fake({}, FIXTURE_TEXT);
    assert.equal(await runInit("init", { ...YES, windowsHome: "/mnt/c/Users/x" }, f.io), 1);
    assert.equal(read(f.settings), FIXTURE_TEXT);
  });
});

describe("unifiedDiff", () => {
  test("equal texts give nothing", () => {
    assert.equal(unifiedDiff("a\nb\n", "a\nb\n", "x", "y"), "");
  });

  test("hunk headers and context", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].join("\n") + "\n";
    const after = ["1", "2", "3", "4", "five", "6", "7", "8", "9", "10", "11"].join("\n") + "\n";
    assert.equal(
      unifiedDiff(before, after, "a", "b", 1),
      ["--- a", "+++ b", "@@ -4,3 +4,3 @@", " 4", "-5", "+five", " 6", "@@ -10,1 +10,2 @@", " 10", "+11", ""].join("\n"),
    );
  });

  test("from nothing", () => {
    assert.equal(unifiedDiff("", "x\ny\n", "a", "b"), ["--- a", "+++ b", "@@ -0,0 +1,2 @@", "+x", "+y", ""].join("\n"));
  });
});

describe("the pixel-office command", () => {
  /** Spawns the CLI with every home-like variable pointing into the temp folder. */
  function cli(args: string[], home: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, PIXEL_OFFICE_HOME: join(home, "po") };
    delete env.CLAUDE_CONFIG_DIR;
    // a developer running the tests inside WSL must not reach cmd.exe
    const wsl = detectWsl() ? ["--windows-home", "/mnt/c/Users/test"] : [];
    return new Promise((ok) => {
      const child = spawn(process.execPath, [CLI, ...args, ...(args[0] === "init" ? wsl : [])], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
      child.on("close", (code) => ok({ code, stdout, stderr }));
      child.stdin.end();
    });
  }

  function homeWithSettings(name: string): { home: string; settings: string } {
    const home = join(root, name);
    const settings = join(home, ".claude", "settings.json");
    mkdirSync(dirname(settings), { recursive: true });
    writeFileSync(settings, FIXTURE_TEXT);
    return { home, settings };
  }

  test("init without --yes on a pipe exits 64 and writes nothing", async () => {
    const { home, settings } = homeWithSettings("cli-64");
    const result = await cli(["init"], home);
    assert.equal(result.code, 64, result.stderr);
    assert.match(result.stderr, /--yes/);
    assert.equal(read(settings), FIXTURE_TEXT);
    assert.equal(existsSync(join(home, "po")), false);
  });

  test("init --dry-run prints a diff and writes nothing", async () => {
    const { home, settings } = homeWithSettings("cli-dry");
    const result = await cli(["init", "--dry-run"], home);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^@@ /m);
    assert.ok(result.stdout.includes(JSON.stringify(process.execPath)), "the node path of this node");
    assert.equal(read(settings), FIXTURE_TEXT);
    assert.equal(existsSync(join(home, "po")), false);
  });

  test("init --yes then uninit --yes round-trips through the real hook path", async () => {
    const { home, settings } = homeWithSettings("cli-yes");
    const added = await cli(["init", "--yes"], home);
    assert.equal(added.code, 0, added.stderr);
    const hookPath = join(dirname(CLI), "hook.js");
    assert.ok(read(settings).includes(JSON.stringify(hookPath)));
    const removed = await cli(["uninit", "--yes"], home);
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(read(settings), FIXTURE_TEXT);
    assert.equal(readdirSync(join(home, "po", "backups")).length, 2);
  });

  test("unknown options give a usage error", async () => {
    const result = await cli(["init", "--force"], join(root, "cli-usage"));
    assert.equal(result.code, 2);
  });
});
