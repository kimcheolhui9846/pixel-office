/**
 * What to draw, as a plain list of rectangles and text (step 2). Pure: the same scene and
 * frame always give the same list, so it is tested in Node without a canvas. Shapes are drawn
 * here from code; there are no outside image assets. A sprite-sheet loader can replace the
 * characters later (step 9).
 */
import type { Scene, SessionStatus } from "@pixel-office/core";

/** Logical size in pixels; the page scales it up by a whole number. */
export const WIDTH = 160;
export const HEIGHT = 96;

export type Op =
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: string; tag?: string }
  | { kind: "text"; x: number; y: number; text: string; color: string; tag?: string };

export interface ArtOptions {
  /** Animation frame (the page counts up at a fixed low rate). */
  frame: number;
  /** prefers-reduced-motion: draw every animated thing at frame 0. */
  reducedMotion: boolean;
  /** False when the page has lost its server. */
  connected: boolean;
}

const C = {
  wall: "#3b4a6b",
  wallTrim: "#2c3654",
  window: "#8ecae6",
  windowFrame: "#e9ecef",
  floorA: "#6b5b4b",
  floorB: "#615242",
  desk: "#8b5a2b",
  deskEdge: "#6f4520",
  monitor: "#22222a",
  screenOff: "#3a3f4b",
  screenCodex: "#4cc9f0",
  screenClaude: "#0b3d20",
  matrix: "#39ff88",
  lampOff: "#4a4a4a",
  lampOn: "#ffd60a",
  alarmOff: "#555560",
  alarmOn: "#ff3b30",
  alarmDim: "#a4161a",
  codex: "#4361ee",
  claude: "#e76f51",
  skin: "#f1c27d",
  coffee: "#6f4e37",
  flag: "#2dc653",
  text: "#f8f9fa",
  dim: "#adb5bd",
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
  room(ops, scene, f);
  codexDesk(ops, scene, f);
  claudeDesk(ops, scene, f);
  codexCharacter(ops, scene, f);
  claudeCharacter(ops, scene, f);
  if (scene.mode === "SUCCESS") {
    confetti(ops, f);
  }
  ops.push({ kind: "text", x: 4, y: 93, text: `Codex: ${LABEL[scene.desks.codex]}`, color: C.text, tag: "label-codex" });
  ops.push({ kind: "text", x: 84, y: 93, text: `Claude: ${LABEL[scene.desks.claude]}`, color: C.text, tag: "label-claude" });
  if (!options.connected) {
    ops.push({ kind: "rect", x: 0, y: 0, w: WIDTH, h: 10, color: C.banner, tag: "disconnected" });
    ops.push({ kind: "text", x: 4, y: 8, text: "연결 안 됨: 다시 연결하는 중", color: C.text, tag: "disconnected" });
  }
  return ops;
}

function room(ops: Op[], scene: Scene, f: number) {
  ops.push({ kind: "rect", x: 0, y: 0, w: WIDTH, h: 24, color: C.wall, tag: "wall" });
  ops.push({ kind: "rect", x: 0, y: 22, w: WIDTH, h: 2, color: C.wallTrim });
  ops.push({ kind: "rect", x: 63, y: 3, w: 34, h: 16, color: C.windowFrame });
  ops.push({ kind: "rect", x: 65, y: 5, w: 14, h: 12, color: C.window });
  ops.push({ kind: "rect", x: 81, y: 5, w: 14, h: 12, color: C.window });
  for (let y = 24; y < 86; y += 8) {
    for (let x = 0; x < WIDTH; x += 8) {
      const odd = ((x + y) / 8) % 2 === 1;
      ops.push({ kind: "rect", x, y, w: 8, h: 8, color: odd ? C.floorB : C.floorA });
    }
  }
  ops.push({ kind: "rect", x: 0, y: 86, w: WIDTH, h: 10, color: "#1b1b24" });
  if (scene.mode === "CLAUDE_ALERT") {
    // a red frame around the room, brighter on every other frame
    const red = f % 2 === 0 ? C.alarmOn : C.alarmDim;
    ops.push({ kind: "rect", x: 0, y: 24, w: WIDTH, h: 2, color: red, tag: "alert-glow" });
    ops.push({ kind: "rect", x: 0, y: 84, w: WIDTH, h: 2, color: red, tag: "alert-glow" });
    ops.push({ kind: "rect", x: 0, y: 24, w: 2, h: 62, color: red, tag: "alert-glow" });
    ops.push({ kind: "rect", x: WIDTH - 2, y: 24, w: 2, h: 62, color: red, tag: "alert-glow" });
  }
}

function codexDesk(ops: Op[], scene: Scene, f: number) {
  const building = scene.mode === "CODEX_BUILDING";
  ops.push({ kind: "rect", x: 12, y: 52, w: 56, h: 10, color: C.desk });
  ops.push({ kind: "rect", x: 12, y: 62, w: 56, h: 2, color: C.deskEdge });
  for (const [i, x] of [16, 32, 48].entries()) {
    ops.push({ kind: "rect", x, y: 38, w: 14, h: 12, color: C.monitor });
    const on = scene.desks.codex !== "idle";
    ops.push({ kind: "rect", x: x + 1, y: 39, w: 12, h: 9, color: on ? C.screenCodex : C.screenOff, tag: `codex-screen-${i}` });
    if (building) {
      // lines of code scrolling on each screen
      for (let line = 0; line < 3; line += 1) {
        const w = 3 + ((f + line * 3 + i * 5) % 8);
        ops.push({ kind: "rect", x: x + 2, y: 40 + line * 3, w, h: 1, color: C.monitor, tag: "codex-typing" });
      }
    }
    ops.push({ kind: "rect", x: x + 6, y: 50, w: 2, h: 2, color: C.monitor });
  }
  ops.push({ kind: "rect", x: 64, y: 44, w: 4, h: 8, color: C.deskEdge });
  ops.push({ kind: "rect", x: 63, y: 40, w: 6, h: 4, color: building ? C.lampOn : C.lampOff, tag: building ? "codex-lamp-on" : "codex-lamp-off" });
}

function claudeDesk(ops: Op[], scene: Scene, f: number) {
  const running = scene.mode === "CLAUDE_RUNNING";
  const alarm = scene.mode === "CLAUDE_ALERT" && scene.focus === "claude";
  ops.push({ kind: "rect", x: 96, y: 52, w: 48, h: 10, color: C.desk });
  ops.push({ kind: "rect", x: 96, y: 62, w: 48, h: 2, color: C.deskEdge });
  ops.push({ kind: "rect", x: 110, y: 36, w: 20, h: 14, color: C.monitor });
  const on = scene.desks.claude !== "idle";
  ops.push({ kind: "rect", x: 111, y: 37, w: 18, h: 11, color: on ? C.screenClaude : C.screenOff, tag: "claude-screen" });
  if (running) {
    // falling green characters
    for (let col = 0; col < 6; col += 1) {
      const y = 37 + ((f * 2 + col * 5) % 10);
      ops.push({ kind: "rect", x: 112 + col * 3, y, w: 1, h: 2, color: C.matrix, tag: "claude-matrix" });
    }
  }
  ops.push({ kind: "rect", x: 119, y: 50, w: 2, h: 2, color: C.monitor });
  const alarmColor = alarm ? (f % 2 === 0 ? C.alarmOn : C.alarmDim) : C.alarmOff;
  ops.push({ kind: "rect", x: 138, y: 40, w: 6, h: 6, color: alarmColor, tag: alarm ? "claude-alarm-on" : "claude-alarm-off" });
  const codexAlarm = scene.mode === "CLAUDE_ALERT" && scene.focus === "codex";
  if (codexAlarm) {
    ops.push({ kind: "rect", x: 8, y: 40, w: 4, h: 4, color: f % 2 === 0 ? C.alarmOn : C.alarmDim, tag: "codex-alarm-on" });
  }
}

/** A character is a body, a head and two arms; `pose` moves the arms. */
function person(ops: Op[], x: number, y: number, color: string, pose: "type" | "fold" | "head" | "rest" | "cheer", tag: string) {
  ops.push({ kind: "rect", x: x + 1, y, w: 6, h: 6, color: C.skin, tag });
  ops.push({ kind: "rect", x, y: y + 6, w: 8, h: 9, color, tag });
  const arms: Record<typeof pose, [number, number, number, number][]> = {
    type: [[-2, 8, 2, 2], [8, 8, 2, 2]],
    fold: [[1, 8, 6, 2]],
    head: [[-1, -1, 2, 5], [7, -1, 2, 5]],
    rest: [[-2, 10, 2, 4], [8, 10, 2, 4]],
    cheer: [[-2, -3, 2, 6], [8, -3, 2, 6]],
  };
  for (const [dx, dy, w, h] of arms[pose]) {
    ops.push({ kind: "rect", x: x + dx, y: y + dy, w, h, color: C.skin, tag: `${tag}-${pose}` });
  }
}

function codexCharacter(ops: Op[], scene: Scene, f: number) {
  switch (scene.mode) {
    case "CODEX_BUILDING":
      person(ops, 36, 64 - (f % 2), C.codex, "type", "codex");
      break;
    case "CLAUDE_RUNNING":
      person(ops, 36, 64, C.codex, "rest", "codex");
      ops.push({ kind: "rect", x: 46, y: 68, w: 3, h: 4, color: C.coffee, tag: "codex-coffee" });
      break;
    case "CLAUDE_ALERT":
      if (scene.focus === "codex") {
        person(ops, 36, 64, C.codex, "head", "codex");
      } else {
        person(ops, 70, 64, C.codex, "rest", "codex"); // turned around, looking worried
      }
      break;
    case "SUCCESS":
      person(ops, 36, 64 - (f % 2), C.codex, "rest", "codex"); // nodding
      break;
    default:
      person(ops, 36, 64, C.codex, "rest", "codex");
  }
}

function claudeCharacter(ops: Op[], scene: Scene, f: number) {
  switch (scene.mode) {
    case "CLAUDE_RUNNING":
      person(ops, 116 + (f % 3) - 1, 64, C.claude, "type", "claude");
      break;
    case "CODEX_BUILDING":
      person(ops, 84, 64, C.claude, "fold", "claude"); // watching from behind
      break;
    case "CLAUDE_ALERT":
      person(ops, 116, 64, C.claude, scene.focus === "claude" ? "head" : "fold", "claude");
      break;
    case "SUCCESS":
      person(ops, 116, 64, C.claude, "cheer", "claude");
      ops.push({ kind: "rect", x: 128, y: 54, w: 1, h: 12, color: C.dim, tag: "pass-flag" });
      ops.push({ kind: "rect", x: 129, y: 54, w: 14, h: 6, color: C.flag, tag: "pass-flag" });
      ops.push({ kind: "text", x: 130, y: 59, text: "PASS", color: C.text, tag: "pass-flag" });
      break;
    default:
      person(ops, 116, 64, C.claude, "fold", "claude");
  }
}

function confetti(ops: Op[], f: number) {
  const colors = ["#ffd60a", "#2dc653", "#4cc9f0", "#e76f51"];
  for (let i = 0; i < 12; i += 1) {
    const x = (i * 37 + 11) % (WIDTH - 2);
    const y = 26 + ((i * 13 + f * 3) % 56);
    ops.push({ kind: "rect", x, y, w: 2, h: 2, color: colors[i % colors.length]!, tag: "confetti" });
  }
}
