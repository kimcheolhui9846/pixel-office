/**
 * Claude Code hook runner (step 4): `node <abs>/hook.js claude`, registered by
 * `pixel-office init`.
 *
 * Reads the hook payload from stdin, maps it with `fromClaudeHook`, and posts the event to
 * the server named in `server.json`. Whatever happens it exits 0 and writes nothing to
 * stdout or stderr: on UserPromptSubmit and SessionStart Claude Code adds hook stdout to
 * Claude's context, and a non-zero exit is reported as a hook error. The whole run has a
 * 500 ms deadline.
 *
 * Only Node built-ins and two small core modules are loaded (no `ws`), to start fast. The
 * core modules are imported dynamically so that even a broken install stays silent.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";

const DEADLINE_MS = 500;
const STDIN_LIMIT = 1024 * 1024;

const started = Date.now();
const debugEnabled = process.env.PIXEL_OFFICE_DEBUG === "1";
let debugHome: string | undefined;
const notes: string[] = [];

function note(line: string): void {
  if (debugEnabled) {
    notes.push(line);
  }
}

/** Debug lines go to `<home>/hook-debug.log`, never to stdout or stderr. No payload text. */
function flushDebug(): void {
  if (!debugEnabled || debugHome === undefined || notes.length === 0) {
    return;
  }
  try {
    mkdirSync(debugHome, { recursive: true });
    appendFileSync(
      join(debugHome, "hook-debug.log"),
      `${new Date().toISOString()} ${Date.now() - started}ms ${notes.join(" | ")}\n`,
    );
  } catch {
    // nowhere to report it, by design
  }
}

let finished = false;
function finish(): never {
  if (!finished) {
    finished = true;
    flushDebug();
  }
  process.exit(0);
}

// Silence everything that could reach stderr: warnings and stray errors.
process.emitWarning = () => {};
process.on("uncaughtException", () => {
  note("uncaught exception");
  finish();
});
process.on("unhandledRejection", () => {
  note("unhandled rejection");
  finish();
});
// A closed stdout or stderr pipe must not crash us into printing a stack trace.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const controller = new AbortController();
const deadline = setTimeout(() => {
  note("deadline");
  controller.abort();
  finish();
}, DEADLINE_MS);
deadline.unref();

function readStdin(): Promise<string | null> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    let size = 0;
    process.stdin.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > STDIN_LIMIT) {
        note("stdin too large");
        process.stdin.destroy();
        done(null);
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => done(null));
  });
}

function post(port: number, token: string, tokenHeader: string, body: string): Promise<number | string> {
  return new Promise((done) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/event",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          [tokenHeader]: token,
        },
        agent: false,
        signal: controller.signal,
      },
      (res) => {
        res.resume();
        res.on("end", () => done(res.statusCode ?? 0));
        res.on("error", () => done("response error"));
      },
    );
    req.on("error", (error: NodeJS.ErrnoException) => done(error.code ?? error.name));
    req.end(body);
  });
}

async function main(): Promise<void> {
  const agent = process.argv[2];
  const { homeDir, readServerInfo, TOKEN_HEADER } = await import("@pixel-office/core/home");
  const home = homeDir();
  debugHome = home;
  if (agent !== "claude") {
    note(`unknown agent ${JSON.stringify(agent ?? "")}`);
    return;
  }
  const raw = await readStdin();
  if (raw === null) {
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    note("stdin is not JSON");
    return;
  }
  const name = (payload as { hook_event_name?: unknown } | null)?.hook_event_name;
  // only a plain event name goes to the debug log, never other payload text
  const hookEvent = typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name) ? name : "?";
  const { fromClaudeHook } = await import("@pixel-office/core");
  const event = fromClaudeHook(payload);
  if (event === null) {
    note(`${hookEvent} -> ignored`);
    return;
  }
  const info = readServerInfo(home);
  if (info === null) {
    note(`${hookEvent} -> ${event.type}, no server.json`);
    return;
  }
  const result = await post(info.port, info.token, TOKEN_HEADER, JSON.stringify(event));
  note(`${hookEvent} -> ${event.type}, POST ${result}`);
}

main().then(finish, () => {
  note("failed");
  finish();
});
