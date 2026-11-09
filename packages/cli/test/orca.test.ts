import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { startServer } from "@pixel-office/core/server";

import {
  isOfficeTab,
  launchOrcaOpen,
  markChecked,
  OPEN_INTERVAL_MS,
  openOfficeTab,
  orcaCommand,
  orcaOpenEnabled,
  orcaWorktree,
  recentlyChecked,
  type OrcaRun,
} from "../src/orca.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const root = mkdtempSync(join(tmpdir(), "pixel-office-orca-"));
after(() => rmSync(root, { recursive: true, force: true }));

describe("orcaWorktree", () => {
  test("the id and the folder from ORCA_WORKTREE_ID", () => {
    assert.deepEqual(orcaWorktree({ ORCA_WORKTREE_ID: "fd0a::C:\\Users\\me\\repo" }), {
      id: "fd0a::C:\\Users\\me\\repo",
      path: "C:\\Users\\me\\repo",
    });
    assert.deepEqual(orcaWorktree({ ORCA_WORKTREE_ID: "r1::/home/me/repo" })?.path, "/home/me/repo");
  });

  test("outside Orca or a malformed id gives null", () => {
    assert.equal(orcaWorktree({}), null);
    assert.equal(orcaWorktree({ ORCA_WORKTREE_ID: "  " }), null);
    assert.equal(orcaWorktree({ ORCA_WORKTREE_ID: "no-separator" }), null);
    assert.equal(orcaWorktree({ ORCA_WORKTREE_ID: "r1::" }), null);
    assert.equal(orcaWorktree({ ORCA_WORKTREE_ID: "r1::/a\nb" }), null);
  });

  test("PIXEL_OFFICE_ORCA_OPEN=0 turns it off", () => {
    assert.equal(orcaOpenEnabled({}), true);
    assert.equal(orcaOpenEnabled({ PIXEL_OFFICE_ORCA_OPEN: "0" }), false);
  });
});

describe("orcaCommand", () => {
  test("ORCA_CLI_COMMAND wins; Linux never runs bare orca", () => {
    assert.equal(orcaCommand({ ORCA_CLI_COMMAND: "/opt/orca/bin/orca-ide" }, "linux"), "/opt/orca/bin/orca-ide");
    assert.equal(orcaCommand({}, "linux"), "orca-ide");
    assert.equal(orcaCommand({}, "darwin"), "orca");
    assert.equal(orcaCommand({ LOCALAPPDATA: join(root, "nowhere") }, "win32"), "orca");
  });
});

describe("isOfficeTab", () => {
  test("our page for the same folder, in any spelling", () => {
    assert.equal(isOfficeTab("http://127.0.0.1:47821/?workspace=C:/Users/me/repo", 47821, "C:\\Users\\me\\repo"), true);
    assert.equal(isOfficeTab("http://localhost:47821/?workspace=c%3A%2Fusers%2Fme%2Frepo%2F", 47821, "C:\\Users\\me\\repo"), true);
  });

  test("another port, folder, page or no folder is not ours", () => {
    const ws = "C:\\Users\\me\\repo";
    assert.equal(isOfficeTab("http://127.0.0.1:1/?workspace=C:/Users/me/repo", 47821, ws), false);
    assert.equal(isOfficeTab("http://127.0.0.1:47821/?workspace=C:/Users/me/repo-old", 47821, ws), false);
    assert.equal(isOfficeTab("http://127.0.0.1:47821/x?workspace=C:/Users/me/repo", 47821, ws), false);
    assert.equal(isOfficeTab("http://127.0.0.1:47821/", 47821, ws), false);
    assert.equal(isOfficeTab("", 47821, ws), false);
    assert.equal(isOfficeTab(undefined, 47821, ws), false);
  });
});

describe("openOfficeTab", () => {
  const worktree = { id: "r1::C:\\work\\repo", path: "C:\\work\\repo" };
  const fake = (tabs: unknown, createOk = true) => {
    const calls: string[][] = [];
    const run: OrcaRun = (args) => {
      calls.push(args);
      if (args[1] === "list") {
        return tabs === null ? null : { ok: true, result: { tabs } };
      }
      return { ok: createOk };
    };
    return { calls, run };
  };

  test("creates the tab when the worktree has none", () => {
    const { calls, run } = fake([{ url: "https://example.com/" }]);
    assert.equal(openOfficeTab(worktree, 47821, run), "created");
    assert.deepEqual(calls, [
      ["tab", "list", "--worktree", "id:r1::C:\\work\\repo"],
      ["tab", "create", "--url", "http://127.0.0.1:47821/?workspace=C:/work/repo", "--worktree", "id:r1::C:\\work\\repo"],
    ]);
  });

  test("leaves an open office tab alone", () => {
    const { calls, run } = fake([{ url: "http://127.0.0.1:47821/?workspace=c:/work/repo" }]);
    assert.equal(openOfficeTab(worktree, 47821, run), "exists");
    assert.equal(calls.length, 1);
  });

  test("Orca not answering, or refusing the tab", () => {
    assert.equal(openOfficeTab(worktree, 47821, fake(null).run), "orca-unavailable");
    assert.equal(openOfficeTab(worktree, 47821, fake([], false).run), "failed");
  });
});

describe("checks are spaced per worktree", () => {
  test("recentlyChecked follows markChecked for OPEN_INTERVAL_MS", () => {
    const home = join(root, "spacing");
    const now = 1_700_000_000_000;
    assert.equal(recentlyChecked(home, "r1::/a", now), false);
    markChecked(home, "r1::/a", now);
    assert.equal(recentlyChecked(home, "r1::/a", now + 1_000), true);
    assert.equal(recentlyChecked(home, "r2::/b", now + 1_000), false);
    assert.equal(recentlyChecked(home, "r1::/a", now + OPEN_INTERVAL_MS), false);
  });

  test("a broken state file counts as never checked", () => {
    const home = join(root, "broken");
    markChecked(home, "x::/y", 1);
    writeFileSync(join(home, "orca-open.json"), "{not json");
    assert.equal(recentlyChecked(home, "x::/y", 2), false);
  });
});

describe("launchOrcaOpen", () => {
  const cliPath = join(SRC, "cli.js");
  const env = { ORCA_WORKTREE_ID: "r1::/work/repo" };

  test("launches once, then waits for the interval", () => {
    const home = join(root, "launch");
    const launched: string[][] = [];
    const spawnFn = ((cmd: string, args: string[]) => {
      launched.push([cmd, ...args]);
      return { on: () => {}, unref: () => {} };
    }) as unknown as typeof spawn;
    assert.equal(launchOrcaOpen({ env, home, cliPath, now: 1_000, spawnFn }), true);
    assert.equal(launchOrcaOpen({ env, home, cliPath, now: 2_000, spawnFn }), false);
    assert.deepEqual(launched, [[process.execPath, cliPath, "orca-open"]]);
  });

  test("nothing outside Orca, when turned off, or without the CLI", () => {
    const home = join(root, "nolaunch");
    const spawnFn = (() => assert.fail("must not spawn")) as unknown as typeof spawn;
    assert.equal(launchOrcaOpen({ env: {}, home, cliPath, now: 1, spawnFn }), false);
    assert.equal(launchOrcaOpen({ env: { ...env, PIXEL_OFFICE_ORCA_OPEN: "0" }, home, cliPath, now: 1, spawnFn }), false);
    assert.equal(launchOrcaOpen({ env, home, cliPath: join(root, "missing.js"), now: 1, spawnFn }), false);
  });
});

describe("hook in an Orca terminal (end to end, fake Orca CLI)", () => {
  test("a prompt opens the worktree's office tab", async () => {
    const home = join(root, "e2e-home");
    const log = join(root, "orca-calls.log");
    // a fake `orca`: records its arguments, has no tabs, accepts the new one
    const fakeJs = join(root, "fake-orca.cjs");
    writeFileSync(
      fakeJs,
      [
        "const fs = require('node:fs');",
        `fs.appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');`,
        "const list = process.argv[3] === 'list';",
        "process.stdout.write(JSON.stringify(list ? { ok: true, result: { tabs: [] } } : { ok: true }));",
      ].join("\n"),
    );
    let fake: string;
    if (process.platform === "win32") {
      fake = join(root, "fake-orca.cmd");
      writeFileSync(fake, `@"${process.execPath}" "${fakeJs}" %*\r\n`);
    } else {
      fake = join(root, "fake-orca");
      writeFileSync(fake, `#!/bin/sh\nexec "${process.execPath}" "${fakeJs}" "$@"\n`);
      chmodSync(fake, 0o755);
    }
    const server = await startServer({ port: 0, home });
    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PIXEL_OFFICE_HOME: home,
        ORCA_WORKTREE_ID: "r1::/work/repo",
        ORCA_CLI_COMMAND: fake,
      };
      delete env.PIXEL_OFFICE_ORCA_OPEN;
      const code = await new Promise<number | null>((done) => {
        const child = spawn(process.execPath, [join(SRC, "hook.js"), "claude"], { env, stdio: ["pipe", "ignore", "ignore"] });
        child.on("close", done);
        child.stdin.end(
          JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: "/work/repo/src", prompt: "x" }),
        );
      });
      assert.equal(code, 0);
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !(existsSync(log) && readFileSync(log, "utf8").includes("create"))) {
        await new Promise((wake) => setTimeout(wake, 100));
      }
      const calls = readFileSync(log, "utf8").trim().split("\n");
      assert.deepEqual(calls, [
        "tab list --worktree id:r1::/work/repo --json",
        `tab create --url http://127.0.0.1:${server.port}/?workspace=/work/repo --worktree id:r1::/work/repo --json`,
      ]);
      assert.ok(recentlyChecked(home, "r1::/work/repo", Date.now()));
    } finally {
      await server.close();
    }
  });
});
