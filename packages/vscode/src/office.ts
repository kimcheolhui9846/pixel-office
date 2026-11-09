/**
 * The VS Code side of Pixel Office (step 7), kept free of the `vscode` module so that it can
 * be tested under plain Node.
 *
 * The webview does not run the office itself. It holds one iframe that loads the page the
 * local server serves for this working folder (`/?workspace=<folder>`). The page is then the
 * same bundle the Orca browser shows, its WebSocket Origin is the server's own origin, and it
 * reads the token from the served HTML, so the webview HTML holds no secret.
 *
 * When no server answers, the extension starts one: the CLI's `start`, detached, run by the
 * editor's own executable as plain Node (`ELECTRON_RUN_AS_NODE=1`). It keeps running after
 * the window closes, so other windows and the agents' hooks keep their server.
 */
import { spawn } from "node:child_process";
import { request } from "node:http";

export type Core = typeof import("@pixel-office/core");
export type Home = typeof import("@pixel-office/core/home");

/** The core modules are ES modules; this package is CommonJS, so they come in by `import()`. */
export async function loadCore(): Promise<{ core: Core; home: Home }> {
  const [core, home] = await Promise.all([import("@pixel-office/core"), import("@pixel-office/core/home")]);
  return { core, home };
}

/** True when a Pixel Office server answers `/health` on this port within `timeoutMs`. */
export function healthy(port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((done) => {
    const req = request({ host: "127.0.0.1", port, path: "/health", method: "GET", timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          done(res.statusCode === 200 && (JSON.parse(body) as { name?: unknown }).name === "pixel-office");
        } catch {
          done(false);
        }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => done(false));
    req.end();
  });
}

/** The port of the server described by `server.json` in `home`, if it answers. */
export async function runningPort(home: string, homeModule: Home): Promise<number | null> {
  const info = homeModule.readServerInfo(home);
  return info !== null && (await healthy(info.port)) ? info.port : null;
}

export interface EnsureOptions {
  home: string;
  homeModule: Home;
  /** Starts a server in the background (normally `spawnServer`). */
  start: () => void;
  timeoutMs?: number;
  pollMs?: number;
}

export class ServerStartError extends Error {}

/**
 * The port of a running server, starting one first when none answers. Another window may be
 * starting one at the same moment; then our copy exits (port in use) and the poll finds theirs.
 */
export async function ensureServer(options: EnsureOptions): Promise<{ port: number; started: boolean }> {
  const found = await runningPort(options.home, options.homeModule);
  if (found !== null) {
    return { port: found, started: false };
  }
  options.start();
  const deadline = Date.now() + (options.timeoutMs ?? 8_000);
  const pollMs = options.pollMs ?? 200;
  while (Date.now() < deadline) {
    await new Promise((wake) => setTimeout(wake, pollMs));
    const port = await runningPort(options.home, options.homeModule);
    if (port !== null) {
      return { port, started: true };
    }
  }
  throw new ServerStartError(
    "Pixel Office 서버를 시작하지 못했습니다. 다른 프로그램이 포트 47821을 쓰고 있는지 확인하거나 터미널에서 `pixel-office start`로 직접 실행해 보세요.",
  );
}

/** Runs `<cli> start` detached with the editor's executable acting as Node. */
export function spawnServer(
  execPath: string,
  cliPath: string,
  env: NodeJS.ProcessEnv = process.env,
  extraArgs: readonly string[] = [],
): void {
  const child = spawn(execPath, [cliPath, "start", ...extraArgs], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
  });
  child.on("error", () => {});
  child.unref();
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The webview page: one full-size iframe on the office address. The policy allows nothing but
 * that frame's origin and inline styles; the page itself has no script.
 */
export function officeHtml(frameUrl: string, title: string): string {
  const origin = new URL(frameUrl).origin;
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${escapeHtml(origin)}; style-src 'unsafe-inline'" />
    <style>
      html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #1b1b24; }
      iframe { display: block; width: 100%; height: 100%; border: 0; }
    </style>
  </head>
  <body>
    <iframe src="${escapeHtml(frameUrl)}" title="${escapeHtml(title)}"></iframe>
  </body>
</html>
`;
}

/** A plain message page (connecting, or what went wrong). */
export function messageHtml(message: string): string {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
    <style>
      html, body { margin: 0; height: 100%; background: #1b1b24; color: #d8d8e0; font: 13px sans-serif; }
      body { display: flex; align-items: center; justify-content: center; padding: 0 24px; text-align: center; }
    </style>
  </head>
  <body><p>${escapeHtml(message)}</p></body>
</html>
`;
}
