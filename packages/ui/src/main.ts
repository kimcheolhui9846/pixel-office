/**
 * The page: draws the office at a low frame rate (10 fps), stops while the tab is hidden,
 * and repaints only when the picture changes. While someone walks (step 9c) it draws at
 * 20 fps for a smoother walk, and goes back to 10 fps as soon as everyone has arrived.
 *
 * Sources: `?demo` plays the shared demo script with no server. Otherwise the page reads
 * the token the server put in a meta tag and follows the server's WebSocket (`/ws`),
 * reconnecting with exponential backoff and showing the "not connected" banner meanwhile.
 */
import { demoScene, MAX_PEOPLE, type Scene, workspaceName } from "@pixel-office/core";

import { art, HEIGHT, type Op, WIDTH } from "./art.js";
import { backoffMs } from "./backoff.js";
import { peopleOf } from "./floor.js";
import { pixelSheet } from "./sheet.js";
import { SPRITES } from "./sprites.js";
import { readToken, TOKEN_META } from "./token.js";
import { actorsAt, moving, nextStage, type Stage } from "./walk.js";

const FPS = 10;
const WALK_FPS = 20;
const IDLE_SCENE: Scene = { mode: "IDLE", focus: null, desks: { codex: "idle", claude: "idle" }, people: [], hidden: 0 };

const canvas = document.getElementById("office") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const sheet = pixelSheet(SPRITES);
const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
const params = new URLSearchParams(location.search);
const demo = params.has("demo");
// `?demo=6000` freezes the demo at 6 s, for screenshots and checks (no `&`: Windows
// cmd.exe, which runs orca.cmd, would cut the URL there)
const at = params.get("demo");
const frozenAt = at ? Number(at) : undefined;
// `?workspace=<folder>`: this office shows only the agents working in that folder (step 6)
const workspace = params.get("workspace")?.trim() || null;
if (workspace !== null) {
  document.title = `Pixel Office · ${workspaceName(workspace)}`;
}
const started = performance.now();

let live: Scene = IDLE_SCENE;
let connected = false;

let stage: Stage | null = null;
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
    if (op.kind === "sprite") {
      sheet.draw(ctx, op.name, op.x, op.y);
    } else if (op.kind === "rect") {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else {
      ctx.fillStyle = op.color;
      ctx.font = "6px monospace";
      ctx.textAlign = op.align ?? "left";
      ctx.fillText(op.text, op.x, op.y); // text only: names from agents are never HTML
    }
  }
}

function step() {
  timer = undefined;
  const now = performance.now();
  const elapsed = frozenAt ?? now - started;
  const current = demo ? demoScene(elapsed) : live;
  stage = nextStage(stage, peopleOf(current).slice(0, MAX_PEOPLE), now, motion.matches);
  // the frame follows the clock, so walking faster does not speed up the other animations
  const frame = Math.floor((now - started) / (1000 / FPS));
  const ops = art(current, { frame, reducedMotion: motion.matches, connected: demo || connected, actors: actorsAt(stage, now) });
  const key = JSON.stringify(ops);
  if (key !== last) {
    paint(ops);
    last = key;
  }
  document.body.dataset.mode = current.mode; // read by tests and the screenshot check
  timer = window.setTimeout(step, 1000 / (moving(stage, now) ? WALK_FPS : FPS));
}

function start() {
  if (timer === undefined) {
    step();
  }
}

function stop() {
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
}

function isScene(value: unknown): value is Scene {
  const v = value as Scene | null;
  return typeof v === "object" && v !== null && typeof v.mode === "string" && typeof v.desks === "object" && v.desks !== null;
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
    const scope = workspace === null ? "" : `&workspace=${encodeURIComponent(workspace)}`;
    const socket = new WebSocket(`ws://${location.host}/ws?token=${encodeURIComponent(token)}${scope}`);
    socket.onmessage = (message: MessageEvent) => {
      try {
        const data = JSON.parse(String(message.data)) as { scene?: unknown };
        if (isScene(data.scene)) {
          // an older server sends no `people`: `peopleOf` then seats one Codex and one Claude
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
