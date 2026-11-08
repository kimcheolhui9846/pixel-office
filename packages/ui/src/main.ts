/**
 * The page: draws the office at a fixed low frame rate (10 fps), stops while the tab is
 * hidden, and repaints only when the picture changes.
 *
 * Sources: `?demo` plays the shared demo script with no server. Otherwise the page reads
 * the token the server put in a meta tag and follows the server's WebSocket (`/ws`),
 * reconnecting with exponential backoff and showing the "not connected" banner meanwhile.
 */
import { demoScene, type Scene } from "@pixel-office/core";

import { art, HEIGHT, type Op, WIDTH } from "./art.js";
import { backoffMs } from "./backoff.js";
import { readToken, TOKEN_META } from "./token.js";

const FPS = 10;
const IDLE_SCENE: Scene = { mode: "IDLE", focus: null, desks: { codex: "idle", claude: "idle" } };

const canvas = document.getElementById("office") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
const params = new URLSearchParams(location.search);
const demo = params.has("demo");
// `?demo=6000` freezes the demo at 6 s, for screenshots and checks (no `&`: Windows
// cmd.exe, which runs orca.cmd, would cut the URL there)
const at = params.get("demo");
const frozenAt = at ? Number(at) : undefined;
const started = performance.now();

let live: Scene = IDLE_SCENE;
let connected = false;

let frame = 0;
let last = "";
let timer: number | undefined;

function fit() {
  const scale = Math.max(1, Math.floor(Math.min(innerWidth / WIDTH, innerHeight / HEIGHT)));
  canvas.width = WIDTH * scale;
  canvas.height = HEIGHT * scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  last = "";
}

function paint(ops: Op[]) {
  for (const op of ops) {
    ctx.fillStyle = op.color;
    if (op.kind === "rect") {
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else {
      ctx.font = "6px monospace";
      ctx.fillText(op.text, op.x, op.y);
    }
  }
}

function step() {
  const elapsed = frozenAt ?? performance.now() - started;
  const current = demo ? demoScene(elapsed) : live;
  const ops = art(current, { frame, reducedMotion: motion.matches, connected: demo || connected });
  const key = JSON.stringify(ops);
  if (key !== last) {
    paint(ops);
    last = key;
  }
  document.body.dataset.mode = current.mode; // read by tests and the screenshot check
  frame += 1;
}

function start() {
  if (timer === undefined) {
    timer = window.setInterval(step, 1000 / FPS);
    step();
  }
}

function stop() {
  if (timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

function isScene(value: unknown): value is Scene {
  const v = value as Scene | null;
  return typeof v === "object" && v !== null && typeof v.mode === "string" && typeof v.desks === "object";
}

/**
 * Follows the server's WebSocket. The server only pushes; the page never sends. When the
 * socket closes (an error is always followed by a close), it retries after a growing delay.
 */
function follow(first: string) {
  let token = first;
  let attempt = 0;
  // the server may have restarted with a new token: read the current one first
  const reopen = async () => {
    try {
      const response = await fetch("/", { cache: "no-store" });
      token = readToken(await response.text()) ?? token;
    } catch {
      // server still down: try the socket anyway, it closes and we come back here
    }
    open();
  };
  const open = () => {
    const socket = new WebSocket(`ws://${location.host}/ws?token=${encodeURIComponent(token)}`);
    socket.onmessage = (message: MessageEvent) => {
      try {
        const data = JSON.parse(String(message.data)) as { scene?: unknown };
        if (isScene(data.scene)) {
          live = data.scene;
          connected = true;
          attempt = 0; // a good message resets the backoff
        }
      } catch {
        // a malformed message is ignored; the next one replaces the scene
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      connected = false;
      window.setTimeout(() => void reopen(), backoffMs(attempt));
      attempt += 1;
    };
  };
  open();
}

if (!demo) {
  const token = document.querySelector<HTMLMetaElement>(`meta[name="${TOKEN_META}"]`)?.content;
  // Without a token (the page was not served by our server) there is nothing to follow,
  // and the banner stays up.
  if (token) {
    follow(token);
  }
}

document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
addEventListener("resize", fit);
fit();
start();
