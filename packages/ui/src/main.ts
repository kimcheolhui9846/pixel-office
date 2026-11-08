/**
 * The page: draws the office at a fixed low frame rate (10 fps), stops while the tab is
 * hidden, and repaints only when the picture changes. Step 2 has only the demo source
 * (`?demo`); the server connection comes in step 3.
 */
import type { Scene } from "@pixel-office/core";

import { art, HEIGHT, type Op, WIDTH } from "./art.js";
import { demoScene } from "./demo.js";

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
  const current = demo ? demoScene(elapsed) : IDLE_SCENE;
  const ops = art(current, { frame, reducedMotion: motion.matches, connected: demo });
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

document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
addEventListener("resize", fit);
fit();
start();
