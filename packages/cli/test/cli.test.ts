import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { DEMO_SCRIPT } from "@pixel-office/core";
import { startServer } from "@pixel-office/core/server";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], home: string): Promise<Run> {
  return new Promise((ok) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, PIXEL_OFFICE_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("close", (code) => ok({ code, stdout, stderr }));
  });
}

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), "pixel-office-cli-"));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("simulate", () => {
  test("delivers the demo events to a running server", async () => {
    const home = join(root, "sim");
    const server = await startServer({ port: 0, home });
    try {
      const result = await run(["simulate", "--loops", "1", "--speed", "50"], home);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(server.stats().accepted, DEMO_SCRIPT.length);
      assert.equal(server.stats().rejected, 0);
      const sessions = Object.values(server.state().sessions);
      assert.deepEqual([...new Set(sessions.map((s) => s.sessionId))].sort(), ["demo-claude", "demo-claude-2", "demo-codex"]);
      assert.ok(sessions.some((s) => s.subagentId === "sub-1"), "the demo subagent arrives");
      assert.match(result.stdout, new RegExp(`이벤트 ${DEMO_SCRIPT.length}개`));
    } finally {
      await server.close();
    }
  });

  test("two loops send the script twice", async () => {
    const home = join(root, "sim2");
    const server = await startServer({ port: 0, home });
    try {
      const result = await run(["simulate", "--loops", "2", "--speed", "100"], home);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(server.stats().accepted, 2 * DEMO_SCRIPT.length);
    } finally {
      await server.close();
    }
  });

  test("without a server it exits non-zero and says to run start", async () => {
    const result = await run(["simulate"], join(root, "empty"));
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /pixel-office start/);
  });

  test("a stale server.json (server gone) is treated as no server", async () => {
    const home = join(root, "stale");
    // a port that was free a moment ago and is closed now
    const probe = createServer();
    await new Promise<void>((ok) => probe.listen(0, "127.0.0.1", ok));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((ok) => probe.close(() => ok()));
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "server.json"),
      JSON.stringify({ port, token: "a".repeat(64), pid: 1, startedAt: new Date().toISOString() }),
    );
    const result = await run(["simulate"], home);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /pixel-office start/);
  });

  test("bad options give a usage error", async () => {
    const result = await run(["simulate", "--loops", "zero"], root);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--loops/);
  });
});

describe("start", () => {
  test("a port in use fails with a clear message", async () => {
    const blocker = createServer();
    await new Promise<void>((ok) => blocker.listen(0, "127.0.0.1", ok));
    const port = (blocker.address() as { port: number }).port;
    try {
      const result = await run(["start", "--port", String(port)], join(root, "busy"));
      assert.equal(result.code, 1);
      assert.match(result.stderr, new RegExp(`포트 ${port}`));
      assert.equal(existsSync(join(root, "busy", "server.json")), false);
    } finally {
      blocker.close();
    }
  });

  test("runs in the foreground, prints the URL and serves /health", async () => {
    const home = join(root, "fg");
    const child = spawn(process.execPath, [CLI, "start", "--port", "0"], {
      env: { ...process.env, PIXEL_OFFICE_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<number | null>((ok) => child.on("close", ok));
    try {
      const url = await new Promise<string>((ok, fail) => {
        let out = "";
        child.stdout.on("data", (c: Buffer) => {
          out += c.toString("utf8");
          const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(out);
          if (m) {
            ok(m[0]);
          }
        });
        setTimeout(() => fail(new Error(`no URL in output: ${out}`)), 10_000);
      });
      const res = await fetch(`${url}health`);
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as { name: string }).name, "pixel-office");
      assert.ok(existsSync(join(home, "server.json")));
      const page = await fetch(url);
      assert.match(await page.text(), /<meta name="pixel-office-token" content="[0-9a-f]{64}" \/>/);
    } finally {
      child.kill("SIGINT");
    }
    const code = await exited;
    // Windows has no real SIGINT for a child process: kill() terminates it at once, so the
    // clean shutdown can only be checked on POSIX here (the manual check covers Windows).
    if (process.platform !== "win32") {
      assert.equal(code, 0);
      assert.equal(existsSync(join(home, "server.json")), false);
    }
  });
});
