/**
 * What to draw, as a plain list of rectangles, text and sprites (steps 2, 9 and 9b). Pure:
 * the same scene and frame always give the same list, so it is tested in Node without a
 * canvas. The still office is one background sprite (`office.ts`); on top of it go the
 * screens, the desk lamp, the warning light, the characters and the effects, which change
 * with the scene. Everything is pixel data written in code, no outside image assets.
 */
import type { Scene, SessionStatus } from "@pixel-office/core";

import {
  BEACON,
  BEACON_OFF,
  CODEX_MONITORS,
  LAMP_HEAD,
  LAMP_OFF,
  MONITOR,
  ROOM_H,
  SCREEN,
  TERMINAL,
} from "./office.js";
import { type Agent, type Pose, SPRITES } from "./sprites.js";

/** Logical size in pixels (16:9); the page scales it up by a whole number. */
export const WIDTH = 240;
export const HEIGHT = 135;

export type Op =
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: string; tag?: string }
  | { kind: "text"; x: number; y: number; text: string; color: string; tag?: string }
  | { kind: "sprite"; name: string; x: number; y: number; w: number; h: number; tag?: string };

export interface ArtOptions {
  /** Animation frame (the page counts up at a fixed low rate). */
  frame: number;
  /** prefers-reduced-motion: draw every animated thing at frame 0. */
  reducedMotion: boolean;
  /** False when the page has lost its server. */
  connected: boolean;
}

const C = {
  ide: "#141d2e",
  code: ["#7fb4ff", "#c3e88d", "#f78c6c", "#89ddff", "#c792ea"],
  codeText: "#8b97ad",
  terminal: "#0b1510",
  matrixTail: "#1f9e55",
  matrixHead: "#b8ffd0",
  logText: "#9aa5b1",
  logError: "#ff5c5c",
  ok: "#5ad17a",
  lampOn: "#ffd65a",
  bulb: "#fff6c8",
  alarmOn: "#ff3b30",
  alarmDim: "#a4161a",
  bar: "#161922",
  barLine: "#2c3246",
  codex: "#3d6fd6",
  claude: "#e2795a",
  text: "#e9ecf2",
  banner: "#9d0208",
} as const;

const LABEL: Record<SessionStatus, string> = {
  idle: "쉬는 중",
  working: "작업 중",
  waiting: "응답 대기",
  alert: "문제 발생",
  success: "완료",
};

export function art(scene: Scene, options: ArtOptions): Op[] {
  const f = options.reducedMotion ? 0 : options.frame;
  const ops: Op[] = [];
  sprite(ops, "office", 0, 0, "room");
  codexDesk(ops, scene, f);
  claudeDesk(ops, scene, f);
  codexCharacter(ops, scene, f);
  claudeCharacter(ops, scene, f);
  if (scene.mode === "SUCCESS") {
    confetti(ops, f);
  }
  if (scene.mode === "CLAUDE_ALERT") {
    // a red frame around the room, brighter on every other frame
    const red = f % 2 === 0 ? C.alarmOn : C.alarmDim;
    rect(ops, 0, 0, WIDTH, 2, red, "alert-glow");
    rect(ops, 0, ROOM_H - 2, WIDTH, 2, red, "alert-glow");
    rect(ops, 0, 2, 2, ROOM_H - 4, red, "alert-glow");
    rect(ops, WIDTH - 2, 2, 2, ROOM_H - 4, red, "alert-glow");
  }
  labels(ops, scene);
  if (!options.connected) {
    rect(ops, 0, 0, WIDTH, 10, C.banner, "disconnected");
    ops.push({ kind: "text", x: 4, y: 8, text: "연결 안 됨: 다시 연결하는 중", color: C.text, tag: "disconnected" });
  }
  return ops;
}

function labels(ops: Op[], scene: Scene) {
  rect(ops, 0, ROOM_H, WIDTH, HEIGHT - ROOM_H, C.bar);
  rect(ops, 0, ROOM_H, WIDTH, 1, C.barLine);
  rect(ops, 6, 126, 4, 4, C.codex);
  ops.push({ kind: "text", x: 13, y: 131, text: `Codex: ${LABEL[scene.desks.codex]}`, color: C.text, tag: "label-codex" });
  rect(ops, 126, 126, 4, 4, C.claude);
  ops.push({ kind: "text", x: 133, y: 131, text: `Claude: ${LABEL[scene.desks.claude]}`, color: C.text, tag: "label-claude" });
}

/** Six lines of code on one screen; `n` moves them along. */
function code(ops: Op[], x: number, y: number, n: number, tag?: string) {
  for (let line = 0; line < 6; line += 1) {
    const k = n + line;
    const indent = [0, 2, 4, 4, 2, 0, 2][k % 7]!;
    const w1 = 2 + ((k * 5) % 5);
    const w2 = 2 + ((k * 3) % 8);
    const cy = y + 1 + line * 2;
    rect(ops, x + 1 + indent, cy, w1, 1, C.code[k % C.code.length]!, tag);
    rect(ops, x + 2 + indent + w1, cy, w2, 1, C.codeText, tag);
  }
}

function codexDesk(ops: Op[], scene: Scene, f: number) {
  const building = scene.mode === "CODEX_BUILDING";
  const on = scene.desks.codex !== "idle";
  const trouble = scene.mode === "CLAUDE_ALERT" && scene.focus === "codex";
  const typing = building ? "codex-typing" : undefined;
  if (on) {
    CODEX_MONITORS.forEach((mx, i) => {
      const x = mx + SCREEN.dx;
      const y = MONITOR.y + SCREEN.dy;
      rect(ops, x, y, SCREEN.w, SCREEN.h, C.ide, `codex-screen-${i}`);
      if (i < 2) {
        code(ops, x, y, building ? f + i * 4 : i * 4, typing);
      } else {
        // the right screen runs the build: a short log and a progress bar
        for (let line = 0; line < 4; line += 1) {
          const k = (building ? f : 0) + line;
          rect(ops, x + 2, y + 1 + line * 2, 4 + ((k * 7) % 14), 1, C.codeText, typing);
        }
        rect(ops, x + 1, y + 10, SCREEN.w - 2, 2, "#2a3a55");
        const done = building ? 2 + (f % 19) : SCREEN.w - 2;
        rect(ops, x + 1, y + 10, done, 2, trouble ? C.logError : C.ok, typing);
      }
      if (trouble && i === 1) {
        rect(ops, x + 1, y + 5, SCREEN.w - 2, 3, "#5a1a20", "codex-error");
        rect(ops, x + 3, y + 6, 12, 1, C.logError, "codex-error");
      }
    });
  }
  if (building) {
    sprite(ops, "lamp-glow", LAMP_HEAD.x - 7, LAMP_HEAD.y + LAMP_HEAD.h);
    rect(ops, LAMP_HEAD.x, LAMP_HEAD.y, LAMP_HEAD.w, LAMP_HEAD.h, C.lampOn, "codex-lamp-on");
    rect(ops, LAMP_HEAD.x + 1, LAMP_HEAD.y + LAMP_HEAD.h, LAMP_HEAD.w - 2, 1, C.bulb);
  } else {
    rect(ops, LAMP_HEAD.x, LAMP_HEAD.y, LAMP_HEAD.w, LAMP_HEAD.h, LAMP_OFF, "codex-lamp-off");
  }
  if (trouble) {
    // a small warning light on the codex desk
    const bright = f % 2 === 0;
    if (bright) sprite(ops, "alarm-glow", 21, 62);
    const red = bright ? C.alarmOn : C.alarmDim;
    rect(ops, 30, 77, 7, 2, "#2a2d36");
    rect(ops, 31, 72, 5, 5, red, "codex-alarm-on");
    rect(ops, 32, 71, 3, 1, red, "codex-alarm-on");
  }
}

function claudeDesk(ops: Op[], scene: Scene, f: number) {
  const running = scene.mode === "CLAUDE_RUNNING";
  const alarm = scene.mode === "CLAUDE_ALERT" && scene.focus === "claude";
  const { x, y, w, h } = TERMINAL;
  if (scene.desks.claude !== "idle") {
    rect(ops, x, y, w, h, C.terminal, "claude-screen");
    if (running) {
      // falling green characters: a bright head and a trail
      for (let col = 0; col < 9; col += 1) {
        const cx = x + 1 + col * 3;
        const head = y + ((f * 2 + col * 7) % h);
        const top = Math.max(y, head - 4);
        if (head > top) rect(ops, cx, top, 1, head - top, C.matrixTail, "claude-matrix");
        rect(ops, cx, head, 1, 1, C.matrixHead, "claude-matrix");
      }
    } else if (alarm) {
      // log lines, the failing ones in red
      for (let line = 0; line < 7; line += 1) {
        const bad = line === 2 || line === 5;
        rect(ops, x + 2, y + 1 + line * 2, bad ? 20 : 8 + ((line * 5) % 12), 1, bad ? C.logError : C.logText, "claude-log");
      }
    } else if (scene.desks.claude === "success") {
      for (let line = 0; line < 5; line += 1) {
        rect(ops, x + 2, y + 1 + line * 2, 6 + ((line * 7) % 14), 1, C.logText);
      }
      rect(ops, x + 2, y + 12, 3, 1, C.ok, "claude-ok");
      rect(ops, x + 6, y + 12, 12, 1, C.ok, "claude-ok");
    } else {
      // a prompt waiting for input
      rect(ops, x + 2, y + 2, 2, 1, C.ok);
      rect(ops, x + 5, y + 2, 3, 1, C.text);
    }
  }
  if (alarm) {
    const bright = f % 2 === 0;
    if (bright) sprite(ops, "alarm-glow", BEACON.x + 2 - 12, BEACON.y + 2 - 12);
    const red = bright ? C.alarmOn : C.alarmDim;
    rect(ops, BEACON.x, BEACON.y, BEACON.w, BEACON.h, red, "claude-alarm-on");
    rect(ops, BEACON.x + 1, BEACON.y - 1, BEACON.w - 2, 1, red);
    if (bright) rect(ops, BEACON.x + 1, BEACON.y + 1, 1, 1, "#ffc2bd");
  } else {
    rect(ops, BEACON.x, BEACON.y, BEACON.w, BEACON.h, BEACON_OFF, "claude-alarm-off");
  }
}

/** A character frame from the sprite sheet, tagged `<agent>-<pose>` (read by the tests). */
function person(ops: Op[], agent: Agent, pose: Pose, x: number, y: number) {
  const name = `${agent}/${pose}`;
  const s = SPRITES[name]!;
  ops.push({ kind: "sprite", name, x, y, w: s.w, h: s.h, tag: `${agent}-${pose}` });
}

const SEAT_Y = 68;
const CODEX_X = 69;
const CLAUDE_X = 166;

function codexCharacter(ops: Op[], scene: Scene, f: number) {
  switch (scene.mode) {
    case "CODEX_BUILDING":
      // storm typing: the hands swap on every frame
      person(ops, "codex", f % 2 === 0 ? "type0" : "type1", CODEX_X, SEAT_Y);
      break;
    case "CLAUDE_RUNNING":
      person(ops, "codex", "coffee", CODEX_X, SEAT_Y);
      break;
    case "CLAUDE_ALERT":
      if (scene.focus === "codex") {
        person(ops, "codex", "head", CODEX_X, SEAT_Y);
      } else {
        person(ops, "codex", "worried", 106, 76); // rolled back and turned round, towards Claude
      }
      break;
    case "SUCCESS":
      person(ops, "codex", Math.floor(f / 3) % 2 === 0 ? "rest" : "nod", CODEX_X, SEAT_Y);
      break;
    default:
      sprite(ops, "blueprint", 88, 77, "codex-blueprint");
      person(ops, "codex", "chin", CODEX_X, SEAT_Y);
  }
}

function claudeCharacter(ops: Op[], scene: Scene, f: number) {
  switch (scene.mode) {
    case "CLAUDE_RUNNING":
      person(ops, "claude", Math.floor(f / 2) % 2 === 0 ? "type0" : "type1", CLAUDE_X + (f % 3) - 1, SEAT_Y);
      break;
    case "CODEX_BUILDING":
      person(ops, "claude", "fold", 118, 84); // rolled over, watching from behind
      break;
    case "CLAUDE_ALERT":
      person(ops, "claude", scene.focus === "claude" ? "head" : "fold", CLAUDE_X, SEAT_Y);
      break;
    case "SUCCESS":
      sprite(ops, "pass-flag", 192, 47, "pass-flag");
      person(ops, "claude", "cheer", CLAUDE_X, SEAT_Y);
      break;
    default:
      person(ops, "claude", "fold", CLAUDE_X, SEAT_Y);
  }
}

function rect(ops: Op[], x: number, y: number, w: number, h: number, color: string, tag?: string) {
  ops.push({ kind: "rect", x, y, w, h, color, ...(tag ? { tag } : {}) });
}

function sprite(ops: Op[], name: string, x: number, y: number, tag?: string) {
  const s = SPRITES[name]!;
  ops.push({ kind: "sprite", name, x, y, w: s.w, h: s.h, ...(tag ? { tag } : {}) });
}

function confetti(ops: Op[], f: number) {
  const colors = ["#ffd60a", "#2dc653", "#4cc9f0", "#e76f51", "#c792ea"];
  for (let i = 0; i < 18; i += 1) {
    const x = ((i * 53 + 11) % (WIDTH - 4)) + 1;
    const y = 6 + ((i * 29 + f * 3) % (ROOM_H - 14));
    const wide = (i + Math.floor(f / 2)) % 2 === 0;
    rect(ops, x, y, wide ? 2 : 1, wide ? 1 : 2, colors[i % colors.length]!, "confetti");
  }
}
