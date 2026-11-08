import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { startServer } from "@pixel-office/core/server";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hook.js");

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), "pixel-office-hook-"));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Runs the built hook with HOME, USERPROFILE and PIXEL_OFFICE_HOME in temp folders. */
function runHook(stdin: string | Buffer, home: string, extraEnv: Record<string, string> = {}, args = ["claude"]): Promise<Run> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, USERPROFILE: root, PIXEL_OFFICE_HOME: home, ...extraEnv };
  if (!("PIXEL_OFFICE_DEBUG" in extraEnv)) {
    delete env.PIXEL_OFFICE_DEBUG;
  }
  return new Promise((ok) => {
    const begin = Date.now();
    const child = spawn(process.execPath, [HOOK, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.stdin.on("error", () => {});
    child.on("close", (code) => ok({ code, stdout, stderr, ms: Date.now() - begin }));
    child.stdin.end(stdin);
  });
}

function assertSilent(result: Run): void {
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.ok(result.ms < 1_000, `took ${result.ms} ms`);
}

const payload = (fields: Record<string, unknown>) =>
  JSON.stringify({ session_id: "sess-1", cwd: "/work/repo", transcript_path: "/x.jsonl", ...fields });

function writeServerJson(home: string, port: number, token = "b".repeat(64)): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "server.json"), JSON.stringify({ port, token, pid: 1, startedAt: new Date().toISOString() }));
}

describe("hook.js against a real server", () => {
  test("a PreToolUse payload arrives as tool_start", async () => {
    const home = join(root, "real");
    const server = await startServer({ port: 0, home });
    try {
      const result = await runHook(
        payload({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf secret" } }),
        home,
      );
      assertSilent(result);
      assert.equal(server.stats().accepted, 1);
      const session = server.state().sessions["claude:sess-1"];
      assert.equal(session?.status, "working");
      assert.equal(session?.detail, "Bash");
      assert.equal(session?.cwd, "/work/repo");
    } finally {
      await server.close();
    }
  });

  test("a test run then a permission prompt", async () => {
    const home = join(root, "real2");
    const server = await startServer({ port: 0, home });
    try {
      assertSilent(
        await runHook(payload({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test" } }), home),
      );
      assert.equal(server.state().sessions["claude:sess-1"]?.status, "success");
      assertSilent(await runHook(payload({ hook_event_name: "Notification", notification_type: "permission_prompt" }), home));
      assert.equal(server.state().sessions["claude:sess-1"]?.status, "waiting");
      assert.equal(server.stats().accepted, 2);
    } finally {
      await server.close();
    }
  });

  test("an unmapped event sends nothing", async () => {
    const home = join(root, "real3");
    const server = await startServer({ port: 0, home });
    try {
      assertSilent(await runHook(payload({ hook_event_name: "SessionStart", source: "startup" }), home));
      assert.equal(server.stats().accepted + server.stats().rejected, 0);
    } finally {
      await server.close();
    }
  });

  test("a wrong token is rejected by the server and the hook stays silent", async () => {
    const home = join(root, "wrong-token");
    const server = await startServer({ port: 0, home: join(root, "wrong-token-server") });
    try {
      writeServerJson(home, server.port, "c".repeat(64));
      assertSilent(await runHook(payload({ hook_event_name: "Stop" }), home));
      assert.equal(server.stats().accepted, 0);
      assert.equal(server.stats().rejected, 1);
    } finally {
      await server.close();
    }
  });
});

describe("hook.js always ends silently with exit 0", () => {
  test("no server.json", async () => {
    assertSilent(await runHook(payload({ hook_event_name: "Stop" }), join(root, "none")));
  });

  test("a bad server.json", async () => {
    const home = join(root, "bad-json");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "server.json"), "{not json");
    assertSilent(await runHook(payload({ hook_event_name: "Stop" }), home));
  });

  test("server.json pointing at a closed port", async () => {
    const probe = createServer();
    await new Promise<void>((ok) => probe.listen(0, "127.0.0.1", ok));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((ok) => probe.close(() => ok()));
    const home = join(root, "refused");
    writeServerJson(home, port);
    assertSilent(await runHook(payload({ hook_event_name: "Stop" }), home));
  });

  test("garbage stdin", async () => {
    const home = join(root, "garbage");
    assertSilent(await runHook("\u0000\u0001 not json at all", home));
    assertSilent(await runHook("", home));
    assertSilent(await runHook("[1,2,3]", home));
    assertSilent(await runHook("null", home));
  });

  test("stdin over 1 MiB", async () => {
    const home = join(root, "huge");
    const big = Buffer.alloc(1024 * 1024 + 10, 0x20);
    assertSilent(await runHook(big, home));
  });

  test("a server that accepts and never answers (deadline)", async () => {
    const sockets: Socket[] = [];
    const hanging = createServer((socket) => {
      sockets.push(socket);
      socket.on("error", () => {});
    });
    await new Promise<void>((ok) => hanging.listen(0, "127.0.0.1", ok));
    const port = (hanging.address() as { port: number }).port;
    const home = join(root, "hanging");
    writeServerJson(home, port);
    try {
      const result = await runHook(payload({ hook_event_name: "Stop" }), home);
      assertSilent(result);
      assert.ok(result.ms >= 400, `ended after ${result.ms} ms, before the deadline`);
      assert.ok(sockets.length >= 1, "the hook did connect");
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((ok) => hanging.close(() => ok()));
    }
  });

  test("an unknown agent argument", async () => {
    assertSilent(await runHook(payload({ hook_event_name: "Stop" }), join(root, "agent"), {}, ["codex-later"]));
    assertSilent(await runHook(payload({ hook_event_name: "Stop" }), join(root, "agent"), {}, []));
  });

  test("PIXEL_OFFICE_DEBUG=1 writes a log file, not to stdout or stderr", async () => {
    const home = join(root, "debug");
    const result = await runHook(
      payload({ hook_event_name: "UserPromptSubmit", prompt: "top secret prompt" }),
      home,
      { PIXEL_OFFICE_DEBUG: "1" },
    );
    assertSilent(result);
    const log = join(home, "hook-debug.log");
    assert.ok(existsSync(log));
    const text = readFileSync(log, "utf8");
    assert.match(text, /UserPromptSubmit -> start, no server\.json/);
    assert.doesNotMatch(text, /secret/);
  });

  test("without PIXEL_OFFICE_DEBUG nothing is written to the home folder", async () => {
    const home = join(root, "quiet");
    assertSilent(await runHook(payload({ hook_event_name: "Stop" }), home));
    assert.equal(existsSync(home), false);
  });
});
