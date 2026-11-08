import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect, createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import WebSocket from "ws";

import {
  checkEvent,
  injectToken,
  PortInUseError,
  type RunningServer,
  startServer,
  type Snapshot,
} from "../src/node/server.js";

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function call(
  port: number,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<Reply> {
  return new Promise((ok, fail) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path ?? "/",
        headers: { host: `127.0.0.1:${port}`, ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          ok({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", fail);
    req.end(options.body);
  });
}

function event(extra: Record<string, unknown> = {}) {
  return { agent: "codex", type: "start", sessionId: "s1", cwd: "D:/work", ts: Date.now(), ...extra };
}

function post(server: RunningServer, body: unknown, headers: Record<string, string> = {}) {
  return call(server.port, {
    method: "POST",
    path: "/event",
    headers: { "content-type": "application/json", "x-pixel-office-token": server.token, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

interface Live {
  messages: Snapshot[];
  raw: string[];
  socket: WebSocket;
  closed: Promise<{ code: number }>;
  until(check: (s: Snapshot) => boolean, timeoutMs?: number): Promise<Snapshot>;
  close(): void;
}

/**
 * Opens a WebSocket like the page would (own Origin, token in the query). Resolves with
 * the HTTP status when the upgrade is refused.
 */
function live(
  port: number,
  options: { token?: string | null; origin?: string | null; host?: string; path?: string } = {},
): Promise<Live | { status: number }> {
  const path = options.path ?? "/ws";
  const query = options.token === null ? "" : `?token=${options.token ?? ""}`;
  const origin = options.origin === undefined ? `http://127.0.0.1:${port}` : options.origin;
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}${query}`, {
    ...(origin === null ? {} : { origin }),
    headers: { host: options.host ?? `127.0.0.1:${port}` },
  });
  const messages: Snapshot[] = [];
  const raw: string[] = [];
  const waiters: (() => void)[] = [];
  socket.on("message", (data) => {
    raw.push(data.toString());
    messages.push(JSON.parse(data.toString()) as Snapshot);
    waiters.splice(0).forEach((w) => w());
  });
  const closed = new Promise<{ code: number }>((ok) => socket.on("close", (code) => ok({ code })));
  return new Promise((ok, fail) => {
    socket.on("unexpected-response", (_req, res) => {
      ok({ status: res.statusCode ?? 0 });
      socket.terminate();
    });
    socket.on("error", (error) => fail(error));
    socket.on("open", () =>
      ok({
        messages,
        raw,
        socket,
        closed,
        async until(check, timeoutMs = 3_000) {
          const deadline = Date.now() + timeoutMs;
          for (;;) {
            const found = messages.find(check);
            if (found) {
              return found;
            }
            if (Date.now() > deadline) {
              throw new Error(`timed out; saw ${JSON.stringify(messages.map((m) => m.scene.mode))}`);
            }
            await new Promise<void>((wake) => {
              waiters.push(wake);
              setTimeout(wake, 50);
            });
          }
        },
        close: () => socket.close(),
      }),
    );
  });
}

async function open(port: number, token: string): Promise<Live> {
  const result = await live(port, { token });
  assert.ok("socket" in result, `upgrade refused with ${"status" in result ? result.status : "?"}`);
  return result;
}

let root: string;
let server: RunningServer;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "pixel-office-test-"));
  mkdirSync(join(root, "web", "app"), { recursive: true });
  writeFileSync(join(root, "web", "index.html"), "<!doctype html><html><head><title>t</title></head><body></body></html>");
  writeFileSync(join(root, "web", "app", "main.js"), "export {};\n");
  writeFileSync(join(root, "web", ".hidden"), "secret");
  writeFileSync(join(root, "package.json"), '{"secret":true}');
  server = await startServer({
    port: 0,
    home: join(root, "home"),
    staticDir: join(root, "web"),
    tickMs: 25,
    timing: { holdMs: 150 },
  });
});

after(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

describe("binding and server.json", () => {
  test("listens on 127.0.0.1 only", async () => {
    const reached = (host: string) =>
      new Promise<boolean>((ok) => {
        const socket = connect({ host, port: server.port }, () => {
          socket.destroy();
          ok(true);
        });
        socket.on("error", () => ok(false));
      });
    assert.equal(await reached("127.0.0.1"), true);
    assert.equal(await reached("::1"), false);
  });

  test("server.json holds port, a 64-hex token, pid and start time", () => {
    const info = JSON.parse(readFileSync(join(root, "home", "server.json"), "utf8"));
    assert.equal(info.port, server.port);
    assert.match(info.token, /^[0-9a-f]{64}$/);
    assert.equal(info.token, server.token);
    assert.equal(info.pid, process.pid);
    assert.ok(!Number.isNaN(Date.parse(info.startedAt)));
  });

  test("close removes server.json; a file that is no longer ours is kept", async () => {
    const home = join(root, "home2");
    const a = await startServer({ port: 0, home });
    assert.ok(existsSync(join(home, "server.json")));
    await a.close();
    assert.equal(existsSync(join(home, "server.json")), false);

    const b = await startServer({ port: 0, home });
    const other = { port: 1, token: "f".repeat(64), pid: process.pid + 1, startedAt: new Date().toISOString() };
    writeFileSync(join(home, "server.json"), JSON.stringify(other));
    await b.close();
    assert.ok(existsSync(join(home, "server.json")), "another server's file stays");
  });

  test("a port already in use fails clearly", async () => {
    const blocker: TcpServer = createTcpServer();
    await new Promise<void>((ok) => blocker.listen(0, "127.0.0.1", ok));
    const port = (blocker.address() as { port: number }).port;
    try {
      await assert.rejects(startServer({ port, home: join(root, "home3") }), (error: unknown) => {
        assert.ok(error instanceof PortInUseError);
        assert.equal(error.port, port);
        assert.match(error.message, new RegExp(`port ${port} is already in use`));
        return true;
      });
      assert.equal(existsSync(join(root, "home3", "server.json")), false);
    } finally {
      blocker.close();
    }
  });
});

describe("request guards", () => {
  test("a wrong Host gives 403 on every route", async () => {
    for (const [method, path] of [
      ["GET", "/"],
      ["GET", "/health"],
      ["POST", "/event"],
      ["OPTIONS", "/event"],
      ["GET", "/app/main.js"],
    ] as const) {
      for (const host of [`evil.example:${server.port}`, "127.0.0.1", `127.0.0.1:${server.port + 1}`]) {
        const reply = await call(server.port, { method, path, headers: { host } });
        assert.equal(reply.status, 403, `${method} ${path} with ${host}`);
      }
    }
  });

  test("localhost:<port> is accepted as Host", async () => {
    const reply = await call(server.port, { path: "/health", headers: { host: `localhost:${server.port}` } });
    assert.equal(reply.status, 200);
  });

  test("a foreign Origin gives 403; our own origin passes", async () => {
    for (const origin of ["http://evil.example", "null", `http://127.0.0.1:${server.port + 1}`]) {
      const reply = await post(server, event(), { origin });
      assert.equal(reply.status, 403, origin);
      const page = await call(server.port, { path: "/", headers: { origin } });
      assert.equal(page.status, 403, origin);
    }
    const own = await post(server, event(), { origin: `http://127.0.0.1:${server.port}` });
    assert.equal(own.status, 204);
  });

  test("allowedOrigins lets a listed origin through", async () => {
    const s = await startServer({ port: 0, home: join(root, "home4"), allowedOrigins: ["vscode-webview://abc"] });
    try {
      const reply = await post(s, event(), { origin: "vscode-webview://abc" });
      assert.equal(reply.status, 204);
    } finally {
      await s.close();
    }
  });

  test("OPTIONS gives 405 with no access-control headers", async () => {
    const reply = await call(server.port, {
      method: "OPTIONS",
      path: "/event",
      headers: { "access-control-request-method": "POST" },
    });
    assert.equal(reply.status, 405);
    const cors = Object.keys(reply.headers).filter((h) => h.startsWith("access-control-"));
    assert.deepEqual(cors, []);
  });
});

describe("POST /event", () => {
  test("no token or a wrong token gives 401", async () => {
    const body = JSON.stringify(event());
    const none = await call(server.port, {
      method: "POST",
      path: "/event",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(none.status, 401);
    assert.equal((await post(server, event(), { "x-pixel-office-token": "0".repeat(64) })).status, 401);
    assert.equal((await post(server, event(), { "x-pixel-office-token": "short" })).status, 401);
  });

  test("a non-JSON content type gives 415", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const reply = await post(server, event(), { "content-type": type });
      assert.equal(reply.status, 415, type);
    }
    assert.equal((await post(server, event(), { "content-type": "application/json; charset=utf-8" })).status, 204);
  });

  test("an oversized body gives 413", async () => {
    const big = JSON.stringify(event({ pad: "x".repeat(20_000) }));
    assert.equal((await post(server, big)).status, 413);
  });

  test("invalid fields give 400 with a short reason", async () => {
    const bad: unknown[] = [
      "not json",
      "[1,2]",
      "null",
      event({ agent: "gpt" }),
      event({ type: "tick" }),
      event({ type: "explode" }),
      event({ sessionId: "" }),
      event({ sessionId: "x".repeat(201) }),
      event({ sessionId: 7 }),
      event({ cwd: "x".repeat(1025) }),
      event({ cwd: "a\nb" }),
      event({ ts: "now" }),
      event({ ts: undefined }),
      event({ detail: "x".repeat(41) }),
      event({ detail: 5 }),
    ];
    for (const body of bad) {
      const reply = await post(server, body);
      assert.equal(reply.status, 400, JSON.stringify(body));
      const reason = JSON.parse(reply.body).error as string;
      assert.ok(reason.length > 0 && reason.length < 80, reason);
    }
    assert.equal((await post(server, event({ sessionId: "x".repeat(200), detail: "x".repeat(40) }))).status, 204);
  });

  test("an extra prompt field is dropped before the state and the socket", async () => {
    const ws = await open(server.port, server.token);
    try {
      await ws.until(() => true);
      const secret = "SECRET-PROMPT-TEXT";
      const reply = await post(server, event({ sessionId: "prompt-test", prompt: secret, command: secret, output: secret }));
      assert.equal(reply.status, 204);
      await ws.until((s) => s.sessions.some((x) => x.sessionId === "prompt-test"));
      assert.equal(JSON.stringify(server.state()).includes(secret), false);
      const all = ws.raw.join("\n");
      assert.equal(all.includes(secret), false);
      assert.equal(all.includes('"prompt"'), false);
    } finally {
      ws.close();
    }
  });

  test("the server stamps events with its own clock", () => {
    const checked = checkEvent(event({ ts: 1 }), 1234);
    assert.ok(checked.ok);
    assert.equal(checked.event.ts, 1234);
  });
});

describe("WebSocket /ws", () => {
  test("a valid upgrade receives the initial state, then changes", async () => {
    const ws = await open(server.port, server.token);
    try {
      const first = await ws.until(() => true);
      assert.ok(typeof first.scene.mode === "string" && Array.isArray(first.sessions));
      const claude = event({ agent: "claude", type: "tool_start", sessionId: "c1", detail: "Bash" });
      assert.equal((await post(server, claude)).status, 204);
      const seen = await ws.until((s) => s.scene.mode === "CLAUDE_RUNNING");
      assert.equal(seen.scene.focus, "claude");
      assert.equal(seen.sessions.find((s) => s.sessionId === "c1")?.detail, "Bash");
    } finally {
      ws.close();
    }
  });

  test("localhost origin and host are accepted", async () => {
    const result = await live(server.port, {
      token: server.token,
      origin: `http://localhost:${server.port}`,
      host: `localhost:${server.port}`,
    });
    assert.ok("socket" in result);
    result.close();
  });

  test("a wrong or missing token gives 401", async () => {
    assert.deepEqual(await live(server.port, { token: "a".repeat(64) }), { status: 401 });
    assert.deepEqual(await live(server.port, { token: "" }), { status: 401 });
    assert.deepEqual(await live(server.port, { token: null }), { status: 401 });
  });

  test("a wrong Host gives 403", async () => {
    for (const host of [`evil.example:${server.port}`, "127.0.0.1", `localhost:${server.port + 1}`]) {
      assert.deepEqual(await live(server.port, { token: server.token, host }), { status: 403 }, host);
    }
  });

  test("a foreign or missing Origin gives 403", async () => {
    const origins = [
      "http://evil.example",
      "null",
      `http://127.0.0.1:${server.port + 1}`,
      `https://127.0.0.1:${server.port}`,
      null,
    ];
    for (const origin of origins) {
      assert.deepEqual(await live(server.port, { token: server.token, origin }), { status: 403 }, String(origin));
    }
  });

  test("allowedOrigins lets a listed origin upgrade", async () => {
    const s = await startServer({ port: 0, home: join(root, "home6"), allowedOrigins: ["vscode-webview://abc"] });
    try {
      const result = await live(s.port, { token: s.token, origin: "vscode-webview://abc" });
      assert.ok("socket" in result);
      result.close();
    } finally {
      await s.close();
    }
  });

  test("no other path can upgrade", async () => {
    for (const path of ["/", "/health", "/event", "/events", "/ws/", "/WS", "/ws/x", "/index.html"]) {
      assert.deepEqual(await live(server.port, { token: server.token, path }), { status: 403 }, path);
    }
  });

  test("a 2 KiB client message closes the connection; small ones are ignored", async () => {
    const ws = await open(server.port, server.token);
    await ws.until(() => true);
    ws.socket.send("hello"); // ignored, the connection stays
    await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(ws.socket.readyState, WebSocket.OPEN);
    ws.socket.send("x".repeat(2048));
    const { code } = await ws.closed;
    assert.equal(code, 1009); // message too big
    assert.equal((await call(server.port, { path: "/health" })).status, 200);
  });

  test("clients beyond the cap are refused with 503", async () => {
    const s = await startServer({ port: 0, home: join(root, "home7"), maxClients: 2 });
    const opened: Live[] = [];
    try {
      opened.push(await open(s.port, s.token), await open(s.port, s.token));
      assert.deepEqual(await live(s.port, { token: s.token }), { status: 503 });
      const first = opened.shift()!;
      first.close();
      await first.closed;
      await new Promise((ok) => setTimeout(ok, 50));
      opened.push(await open(s.port, s.token));
    } finally {
      opened.forEach((o) => o.close());
      await s.close();
    }
  });

  test("ticks expire success to idle and the client sees it", async () => {
    const s = await startServer({ port: 0, home: join(root, "home5"), tickMs: 20, timing: { holdMs: 100 } });
    const ws = await open(s.port, s.token);
    try {
      await ws.until(() => true);
      assert.equal((await post(s, event({ type: "success", sessionId: "ok" }))).status, 204);
      await ws.until((x) => x.scene.mode === "SUCCESS");
      const idle = await ws.until((x) => x.sessions.some((y) => y.sessionId === "ok" && y.status === "idle"));
      assert.equal(idle.scene.mode, "IDLE");
    } finally {
      ws.close();
      await s.close();
    }
  });

  test("a client that misses pongs is dropped by the heartbeat", async () => {
    const s = await startServer({ port: 0, home: join(root, "home9"), heartbeatMs: 50 });
    const ws = await open(s.port, s.token);
    try {
      // stop answering pings: pause the socket so the client never reads them
      (ws.socket as unknown as { _socket: { pause(): void } })._socket.pause();
      const deadline = Date.now() + 2_000;
      while (s.stats().clients > 0 && Date.now() < deadline) {
        await new Promise((ok) => setTimeout(ok, 20));
      }
      assert.equal(s.stats().clients, 0);
    } finally {
      ws.socket.terminate();
      await s.close();
    }
  });

  test("close sends clients a going-away close and removes server.json", async () => {
    const home = join(root, "home8");
    const s = await startServer({ port: 0, home });
    const ws = await open(s.port, s.token);
    await s.close();
    assert.equal((await ws.closed).code, 1001);
    assert.equal(existsSync(join(home, "server.json")), false);
  });

  test("the SSE route /events is gone", async () => {
    assert.equal((await call(server.port, { path: `/events?token=${server.token}` })).status, 404);
  });
});

describe("static files and health", () => {
  test("/health shape, without a token", async () => {
    const reply = await call(server.port, { path: "/health" });
    assert.equal(reply.status, 200);
    assert.deepEqual(JSON.parse(reply.body), { ok: true, name: "pixel-office", version: "0.0.0" });
  });

  test("the served index.html contains the token meta", async () => {
    for (const path of ["/", "/index.html"]) {
      const reply = await call(server.port, { path });
      assert.equal(reply.status, 200);
      assert.match(String(reply.headers["content-type"]), /^text\/html/);
      assert.ok(reply.body.includes(`<meta name="pixel-office-token" content="${server.token}" />`));
    }
    const js = await call(server.port, { path: "/app/main.js" });
    assert.equal(js.status, 200);
    assert.match(String(js.headers["content-type"]), /^text\/javascript/);
  });

  test("path traversal and odd paths give 404", async () => {
    for (const path of [
      "/../package.json",
      "/app/../../package.json",
      "/%2e%2e/package.json",
      "/%2E%2E%2Fpackage.json",
      "/..%2fpackage.json",
      "/..%5cpackage.json",
      "/%252e%252e/package.json",
      "/app%2f..%2f..%2fpackage.json",
      "/.hidden",
      "/index.html::$DATA",
      "/index.html%00",
      "/C:/Windows/win.ini",
      "/%E0%A4%A",
      "/app",
      "/nope.js",
    ]) {
      const reply = await call(server.port, { path });
      assert.ok(reply.status === 404 || reply.status === 403, `${path} -> ${reply.status}`);
      assert.equal(reply.body.includes("secret"), false, path);
    }
  });

  test("injectToken puts the meta right after <head>", () => {
    assert.equal(injectToken("<head><title>x</title></head>", "ab"), '<head>\n    <meta name="pixel-office-token" content="ab" /><title>x</title></head>');
  });
});
