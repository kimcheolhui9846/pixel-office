/**
 * The local server (step 3). Node only: it lives in `src/node/` so the page never loads it,
 * and it is exported as `@pixel-office/core/server`.
 *
 * - Binds 127.0.0.1 only. Every request must carry `Host: 127.0.0.1:<port>` or
 *   `localhost:<port>` (DNS-rebinding defence) and, if it has an Origin, our own origin.
 * - `POST /event` takes one agent event: token header, `Content-Type: application/json`
 *   (forces a CORS preflight, which we refuse), 16 KiB body limit, strict fields.
 * - `/ws` is a WebSocket (library `ws`) that only pushes `{scene, sessions}`. The upgrade
 *   needs the right Host, an Origin that is ours (WebSocket has no CORS) and the token.
 * - `GET /health` says that the server on this port is ours.
 * - Everything else under GET is the built UI; `index.html` gets the token in a meta tag.
 *
 * Event contents are never logged; only counts and errors are.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, join, resolve, sep } from "node:path";
import type { Duplex } from "node:stream";

import { type WebSocket, WebSocketServer } from "ws";

import { VERSION } from "../index.js";
import {
  DEFAULT_TIMING,
  EMPTY_STATE,
  type OfficeState,
  reduce,
  scene,
  type Scene,
  type Session,
  type Timing,
} from "../state.js";
import { homeDir, removeServerInfo, TOKEN_HEADER, writeServerInfo } from "./home.js";
import { checkEvent } from "./validate.js";

export { homeDir, readServerInfo, serverInfoPath, type ServerInfo, TOKEN_HEADER } from "./home.js";
export { checkEvent } from "./validate.js";

export const DEFAULT_PORT = 47821;
export const HOST = "127.0.0.1";
export const BODY_LIMIT = 16 * 1024;
export const TOKEN_META = "pixel-office-token";
export const WS_PATH = "/ws";
/** The page never sends anything; a larger client frame closes the connection. */
export const WS_MAX_PAYLOAD = 1024;
export const MAX_CLIENTS = 32;

export interface ServerOptions {
  /** Default 47821. 0 picks a free port (tests). */
  port?: number;
  /** Where `server.json` goes. Default: `PIXEL_OFFICE_HOME` or `~/.pixel-office`. */
  home?: string;
  /** The assembled UI (`packages/ui/dist/web`). Without it only the API is served. */
  staticDir?: string;
  /** Extra origins allowed besides our own (VS Code webviews later). Empty by default. */
  allowedOrigins?: readonly string[];
  /** Tick period, default 1000 ms. */
  tickMs?: number;
  /** WebSocket ping period, default 30 s. A client that misses a pong is dropped. */
  heartbeatMs?: number;
  /** WebSocket clients allowed at once, default 32. */
  maxClients?: number;
  timing?: Partial<Timing>;
  /** Count and error lines. Never receives event contents. */
  log?: (line: string) => void;
}

export interface Snapshot {
  scene: Scene;
  sessions: Session[];
}

export interface RunningServer {
  port: number;
  url: string;
  token: string;
  home: string;
  state(): OfficeState;
  stats(): { accepted: number; rejected: number; clients: number };
  close(): Promise<void>;
}

export class PortInUseError extends Error {
  constructor(readonly port: number) {
    super(`port ${port} is already in use`);
    this.name = "PortInUseError";
  }
}

const STATUS_TEXT: Record<number, string> = {
  401: "Unauthorized",
  403: "Forbidden",
  503: "Service Unavailable",
};

/** Starts the server; resolves once it listens and `server.json` is written. */
export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const home = options.home ?? homeDir();
  const timing: Timing = { ...DEFAULT_TIMING, ...options.timing };
  const tickMs = options.tickMs ?? 1_000;
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const maxClients = options.maxClients ?? MAX_CLIENTS;
  const log = options.log ?? (() => {});
  const staticDir = options.staticDir ? resolve(options.staticDir) : undefined;
  const allowed = options.allowedOrigins ?? [];
  const token = randomBytes(32).toString("hex");
  const tokenHash = digest(token);

  let state: OfficeState = { ...EMPTY_STATE, now: Date.now() };
  let lastPayload = payload(state);
  let accepted = 0;
  let rejected = 0;
  let port = 0;

  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });
  const alive = new WeakMap<WebSocket, boolean>();

  const server = createServer({ maxHeaderSize: 8 * 1024 }, (req, res) => {
    try {
      handle(req, res);
    } catch (error) {
      log(`요청 처리 오류: ${(error as Error).message}`);
      if (!res.headersSent) {
        send(res, 500, { error: "internal error" });
      } else {
        res.destroy();
      }
    }
  });
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      upgrade(req, socket, head);
    } catch (error) {
      log(`연결 처리 오류: ${(error as Error).message}`);
      socket.destroy();
    }
  });

  function hostOk(req: IncomingMessage): boolean {
    // DNS rebinding: the request must have reached us through our own name and port.
    const host = req.headers.host;
    return host === `${HOST}:${port}` || host === `localhost:${port}`;
  }

  function allowedOrigin(origin: string): boolean {
    return (
      origin === `http://${HOST}:${port}` ||
      origin === `http://localhost:${port}` ||
      allowed.includes(origin)
    );
  }

  function tokenOk(candidate: string | null | undefined): boolean {
    // Hashing first gives equal-length buffers, so the comparison is constant time and
    // does not reveal the length of a wrong guess.
    return typeof candidate === "string" && timingSafeEqual(digest(candidate), tokenHash);
  }

  function splitUrl(req: IncomingMessage): [path: string, query: string] {
    const url = req.url ?? "/";
    const q = url.indexOf("?");
    return q < 0 ? [url, ""] : [url.slice(0, q), url.slice(q + 1)];
  }

  function handle(req: IncomingMessage, res: ServerResponse) {
    if (!hostOk(req)) {
      return send(res, 403, { error: "bad host" });
    }
    // Cross-site requests: a present Origin must be ours (or explicitly allowed).
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigin(origin)) {
      return send(res, 403, { error: "bad origin" });
    }
    const [rawPath] = splitUrl(req);
    // No CORS at all: a preflight is answered 405 without any access-control headers.
    if (req.method === "OPTIONS") {
      return send(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD, POST" });
    }
    if (rawPath === "/event") {
      if (req.method !== "POST") {
        return send(res, 405, { error: "method not allowed" }, { allow: "POST" });
      }
      return postEvent(req, res);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
    }
    if (rawPath === "/health") {
      return send(res, 200, { ok: true, name: "pixel-office", version: VERSION });
    }
    return serveStatic(req, res, rawPath);
  }

  /**
   * WebSocket handshakes. Browsers do not apply CORS to WebSocket, so any page could try
   * to open one; the Origin check is the cross-site defence, and a missing Origin is
   * refused (browsers always send it). Failures get a bare HTTP status, then the socket
   * is closed.
   */
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on("error", () => {});
    const refuse = (status: number) => {
      socket.once("finish", () => socket.destroy());
      socket.end(
        `HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    };
    if (!hostOk(req)) {
      return refuse(403);
    }
    const origin = req.headers.origin;
    if (origin === undefined || !allowedOrigin(origin)) {
      return refuse(403);
    }
    const [rawPath, query] = splitUrl(req);
    if (rawPath !== WS_PATH) {
      return refuse(403);
    }
    if (!tokenOk(new URLSearchParams(query).get("token"))) {
      return refuse(401);
    }
    if (wss.clients.size >= maxClients) {
      return refuse(503);
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      alive.set(ws, true);
      ws.on("pong", () => alive.set(ws, true));
      // Client messages are ignored. ws closes the socket (1009) on a frame over
      // maxPayload and reports it as an error; without a listener that would crash us.
      ws.on("error", () => ws.terminate());
      ws.send(lastPayload);
    });
  }

  function postEvent(req: IncomingMessage, res: ServerResponse) {
    let done = false;
    const reject = (status: number, error: string) => {
      done = true;
      rejected += 1;
      // The rest of an unread body is drained, then the connection is closed.
      send(res, status, { error }, { connection: "close" });
      req.resume();
    };
    const header = req.headers[TOKEN_HEADER];
    if (!tokenOk(Array.isArray(header) ? undefined : header)) {
      return reject(401, "bad token");
    }
    const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") {
      return reject(415, "content-type must be application/json");
    }
    if (Number(req.headers["content-length"] ?? 0) > BODY_LIMIT) {
      return reject(413, "body too large");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      if (done) {
        return;
      }
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(413, "body too large");
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", () => {
      done = true;
    });
    req.on("end", () => {
      if (done) {
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reject(400, "invalid json");
      }
      const checked = checkEvent(body, Date.now());
      if (!checked.ok) {
        return reject(400, checked.reason);
      }
      done = true;
      accepted += 1;
      apply(reduce(state, checked.event, timing));
      res.writeHead(204, baseHeaders()).end();
    });
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, rawPath: string) {
    if (!staticDir) {
      return send(res, 404, { error: "not found" });
    }
    let path: string;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      return send(res, 404, { error: "not found" });
    }
    if (path === "/") {
      path = "/index.html";
    }
    // Allow-list the path: plain names only, no dot segments (so no `..` and no dotfiles),
    // no backslashes, colons (Windows streams, drives), `%` or NUL.
    const segments = path.split("/").slice(1);
    const plain =
      /^\/[A-Za-z0-9._\-/]*$/.test(path) && segments.every((s) => s !== "" && !s.startsWith("."));
    if (!plain) {
      return send(res, 404, { error: "not found" });
    }
    const file = resolve(staticDir, ...segments);
    if (!file.startsWith(staticDir + sep)) {
      return send(res, 404, { error: "not found" });
    }
    let body: Buffer;
    try {
      if (!lstatSync(file).isFile()) {
        return send(res, 404, { error: "not found" });
      }
      body = readFileSync(file);
    } catch {
      return send(res, 404, { error: "not found" });
    }
    if (file === join(staticDir, "index.html")) {
      body = Buffer.from(injectToken(body.toString("utf8"), token), "utf8");
    }
    res.writeHead(200, {
      ...baseHeaders(),
      "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      "content-length": body.length,
    });
    res.end(req.method === "HEAD" ? undefined : body);
  }

  function apply(next: OfficeState) {
    state = next;
    const text = payload(state);
    if (text !== lastPayload) {
      lastPayload = text;
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) {
          client.send(text);
        }
      }
    }
  }

  const ticker = setInterval(
    () => apply(reduce(state, { type: "tick", ts: Date.now() }, timing)),
    tickMs,
  );
  // Heartbeat: a client that did not answer the previous ping is dropped.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) {
        client.terminate();
        continue;
      }
      alive.set(client, false);
      client.ping();
    }
  }, heartbeatMs);
  ticker.unref();
  heartbeat.unref();
  const stopTimers = () => {
    clearInterval(ticker);
    clearInterval(heartbeat);
  };

  const wanted = options.port ?? DEFAULT_PORT;
  try {
    await new Promise<void>((ok, fail) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        fail(error.code === "EADDRINUSE" ? new PortInUseError(wanted) : error);
      });
      server.listen({ host: HOST, port: wanted, exclusive: true }, ok);
    });
  } catch (error) {
    stopTimers();
    wss.close();
    throw error;
  }
  port = (server.address() as { port: number }).port;
  server.on("error", (error) => log(`서버 오류: ${error.message}`));

  try {
    writeServerInfo(home, { port, token, pid: process.pid, startedAt: new Date().toISOString() });
  } catch (error) {
    stopTimers();
    wss.close();
    await closeServer(server);
    throw error;
  }

  let closing: Promise<void> | undefined;
  return {
    port,
    url: `http://${HOST}:${port}/`,
    token,
    home,
    state: () => state,
    stats: () => ({ accepted, rejected, clients: wss.clients.size }),
    close() {
      closing ??= (async () => {
        stopTimers();
        removeServerInfo(home, { pid: process.pid, token });
        await closeClients(wss);
        await closeServer(server);
        log(`이벤트 ${accepted}개 받음, ${rejected}개 거부`);
      })();
      return closing;
    },
  };
}

/** Sends a "going away" close to every client, then cuts whoever is still there after 500 ms. */
async function closeClients(wss: WebSocketServer): Promise<void> {
  const clients = [...wss.clients];
  const gone = clients.map(
    (c) => new Promise<void>((ok) => (c.readyState === c.CLOSED ? ok() : c.once("close", () => ok()))),
  );
  for (const client of clients) {
    client.close(1001, "server shutting down");
  }
  await Promise.race([Promise.all(gone), new Promise<void>((ok) => setTimeout(ok, 500).unref())]);
  for (const client of wss.clients) {
    client.terminate();
  }
  await new Promise<void>((ok) => wss.close(() => ok()));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((ok) => {
    server.close(() => ok());
    server.closeAllConnections();
  });
}

/** What clients receive. Sessions are sorted by key so equal states give equal text. */
export function snapshot(state: OfficeState): Snapshot {
  const sessions = Object.keys(state.sessions)
    .sort()
    .map((key) => state.sessions[key]!);
  return { scene: scene(state), sessions };
}

function payload(state: OfficeState): string {
  return JSON.stringify(snapshot(state));
}

/** Adds `<meta name="pixel-office-token">` right after `<head>`. The token is hex. */
export function injectToken(html: string, token: string): string {
  const meta = `<meta name="${TOKEN_META}" content="${token}" />`;
  const match = /<head(\s[^>]*)?>/i.exec(html);
  if (!match) {
    return meta + html;
  }
  const end = match.index + match[0].length;
  return html.slice(0, end) + "\n    " + meta + html.slice(end);
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

function baseHeaders(): OutgoingHttpHeaders {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}

function send(res: ServerResponse, status: number, body: unknown, extra: OutgoingHttpHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...baseHeaders(),
    ...extra,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
