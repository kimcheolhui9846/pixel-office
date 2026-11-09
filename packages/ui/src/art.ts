/**
 * What to draw, as a plain list of rectangles, text and sprites (steps 2, 9, 9b and 9c).
 * Pure: the same scene, frame and actors always give the same list, so it is tested in Node
 * without a canvas. The still office is one background sprite (`office.ts`); on top of it go
 * the zone names, the screens of the people at work, the desk lamp, the warning light, the
 * people themselves and the effects, which change with the scene.
 *
 * Step 9c: one person per agent session and per subagent, seated in the zone of their work
 * (`floor.ts`). The page passes where everyone is at this moment (`walk.ts`); without that
 * everyone sits in their seat.
 */
import { MAX_PEOPLE, type Person, type Scene, type SessionStatus } from "@pixel-office/core";

import { HEIGHT, peopleOf, ROOM_H, WIDTH, ZONE_AREAS } from "./floor.js";
import { BEACON, BEACON_OFF, type Box, DOOR_LEAF, LAMP_HEAD, LAMP_OFF, RACK_LEDS, seatScreens, SIGNS } from "./office.js";
import { frameName, type Pose, SPRITES } from "./sprites.js";
import { type Actor, actorsAt, nextStage } from "./walk.js";

export { HEIGHT, WIDTH } from "./floor.js";

export type Op =
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: string; tag?: string }
  | { kind: "text"; x: number; y: number; text: string; color: string; align?: "left" | "center" | "right"; tag?: string }
  | { kind: "sprite"; name: string; x: number; y: number; w: number; h: number; tag?: string; id?: string };

export interface ArtOptions {
  /** Animation frame (the page counts up at a fixed low rate). */
  frame: number;
  /** prefers-reduced-motion: draw every animated thing at frame 0. */
  reducedMotion: boolean;
  /** False when the page has lost its server. */
  connected: boolean;
  /** Where everyone is right now (from `walk.ts`). Omitted: everyone in their seat. */
  actors?: readonly Actor[];
}

const C = {
  ide: "#141d2e",
  code: ["#7fb4ff", "#c3e88d", "#f78c6c", "#89ddff", "#c792ea"],
  codeText: "#8b97ad",
  terminal: "#0b1510",
  laptop: "#1d2c44",
  board: "#2f6fb5",
  boardLine: "#cfe6ff",
  matrixTail: "#1f9e55",
  matrixHead: "#b8ffd0",
  logText: "#9aa5b1",
  logError: "#ff5c5c",
  diffAdd: "#5ad17a",
  diffDel: "#e06c75",
  ok: "#5ad17a",
  lampOn: "#ffd65a",
  bulb: "#fff6c8",
  alarmOn: "#ff3b30",
  alarmDim: "#a4161a",
  ledOn: "#5dff9a",
  bar: "#161922",
  barLine: "#2c3246",
  codex: "#3d6fd6",
  claude: "#e2795a",
  text: "#e9ecf2",
  dim: "#aab2c0",
  tag: "#161922",
  banner: "#9d0208",
} as const;

/** Short status words for the label bar, most urgent first. */
const STATUS_ORDER: readonly SessionStatus[] = ["alert", "waiting", "working", "success", "idle"];
const STATUS_WORD: Record<SessionStatus, string> = {
  alert: "문제",
  waiting: "대기",
  working: "작업",
  success: "완료",
  idle: "쉼",
};
const STATUS_COLOR: Record<SessionStatus, string> = {
  alert: "#ff6b5e",
  waiting: "#ffd166",
  working: "#7ee0a0",
  success: "#7ee0a0",
  idle: "#aab2c0",
};

/** Width of `s` in the page's 6 px monospace font: about 3.6 px per Latin letter, 6 per Hangul. */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += /[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch) ? 6 : 3.6;
  }
  return Math.ceil(w);
}

/** A subagent's role as a short, safe name tag: printable characters only, at most 7 wide. */
export function roleTag(role: string | undefined): string {
  const clean = [...(role ?? "")].filter((ch) => ch >= " " && ch !== "\u007f").join("").trim();
  if (textWidth(clean) <= 26) return clean;
  let out = "";
  for (const ch of clean) {
    if (textWidth(`${out}${ch}…`) > 26) break;
    out += ch;
  }
  return `${out}…`;
}

export function art(scene: Scene, options: ArtOptions): Op[] {
  const f = options.reducedMotion ? 0 : options.frame;
  const all = peopleOf(scene);
  const people = all.slice(0, MAX_PEOPLE);
  const hidden = (typeof scene.hidden === "number" ? scene.hidden : 0) + (all.length - people.length);
  const actors = options.actors ?? actorsAt(nextStage(null, people, 0, true), 0);
  const ops: Op[] = [];
  sprite(ops, "office", 0, 0, "room");
  for (const s of SIGNS) {
    ops.push({ kind: "text", x: s.x + 8, y: s.y + 8, text: ZONE_AREAS[s.zone].label, color: C.text, tag: "zone-label" });
  }
  if (actors.some((a) => a.walking && a.x < 14 && a.y < 40)) {
    rect(ops, DOOR_LEAF.x, DOOR_LEAF.y, DOOR_LEAF.w, DOOR_LEAF.h, "#151821", "door-open");
    rect(ops, DOOR_LEAF.x, DOOR_LEAF.y + DOOR_LEAF.h - 2, DOOR_LEAF.w, 2, "#3a3f4c");
  }
  actors.forEach((a, k) => {
    if (a.seated && a.person.status !== "idle") {
      seatScreens(a.person.zone, a).forEach((box, i) => screen(ops, a.person, box, f + k * 3 + i * 4));
    }
  });
  lamp(ops, scene.mode === "CODEX_BUILDING");
  rack(ops, actors, f);
  beacon(ops, scene.mode === "CLAUDE_ALERT", f);
  if (scene.mode === "SUCCESS") {
    const hero = actors.find((a) => a.person.status === "success");
    const x = hero ? Math.min(WIDTH - 24, hero.x + 17) : 150;
    const y = hero ? Math.max(0, Math.min(ROOM_H - 31, hero.y - 6)) : 60;
    sprite(ops, "pass-flag", x, y, "pass-flag");
  }
  const order = actors.map((a, k) => ({ a, k })).sort((p, q) => p.a.y - q.a.y || p.a.x - q.a.x || p.k - q.k);
  for (const { a, k } of order) {
    person(ops, scene, a, f + k);
  }
  // name tags last, so a neighbour never hides one
  for (const { a } of order) {
    nameTag(ops, a);
  }
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
  labels(ops, people, hidden);
  if (!options.connected) {
    rect(ops, 0, 0, WIDTH, 10, C.banner, "disconnected");
    ops.push({ kind: "text", x: 4, y: 8, text: "연결 안 됨: 다시 연결하는 중", color: C.text, tag: "disconnected" });
  }
  return ops;
}

/** The pose for a person's status; `f` already carries their own offset. */
function poseOf(scene: Scene, a: Actor, f: number): Pose {
  const { status, agent } = a.person;
  if (a.walking) return a.step === 0 ? "walk0" : "walk1";
  if (!a.seated) return status === "success" && Math.floor(f / 3) % 2 === 0 ? "hooray" : "stand";
  switch (status) {
    case "working":
      // Codex types in a storm (hands swap every frame), Claude every other frame
      return (agent === "codex" ? f : Math.floor(f / 2)) % 2 === 0 ? "type0" : "type1";
    case "waiting":
      return "raise";
    case "alert":
      return "head";
    case "success":
      return Math.floor(f / 3) % 2 === 0 ? "cheer" : "nod";
    case "idle":
      if (scene.mode !== "IDLE" && a.person.kind === "main") return "coffee"; // a break while others work
      return agent === "codex" ? "chin" : "fold";
  }
}

function person(ops: Op[], scene: Scene, a: Actor, f: number) {
  const { agent, kind, status, id } = a.person;
  const sub = kind === "sub";
  const pose = poseOf(scene, a, f);
  const name = frameName(agent, sub, pose);
  const s = SPRITES[name]!;
  ops.push({ kind: "sprite", name, x: a.x, y: a.y, w: s.w, h: s.h, tag: `${agent}${sub ? "-sub" : ""}-${pose}`, id });
  if (!a.walking && (status === "waiting" || status === "alert")) {
    const top = a.seated ? a.y - 4 + (sub ? 2 : 0) : a.y - 12 + (sub ? 2 : 0);
    sprite(ops, status === "alert" ? "bubble-alert" : "bubble-wait", Math.min(WIDTH - 9, a.x + 12), Math.max(0, top), status === "alert" ? "bubble-alert" : "bubble-wait");
  }
}

/** A subagent's role on a small dark tag: under a seated person, over a standing one. */
function nameTag(ops: Op[], a: Actor) {
  if (a.person.kind !== "sub") return;
  const tag = roleTag(a.person.role);
  if (tag === "") return;
  const w = textWidth(tag) + 2;
  const x = Math.max(0, Math.min(WIDTH - w, Math.round(a.x + 10 - w / 2)));
  const y = a.seated ? Math.min(ROOM_H - 7, a.y + 31) : Math.max(0, a.y - 1);
  rect(ops, x, y, w, 7, C.tag, "name-tag");
  ops.push({ kind: "text", x: x + w / 2, y: y + 6, text: tag, color: C.text, align: "center", tag: "name-tag" });
}

function lamp(ops: Op[], on: boolean) {
  if (on) {
    sprite(ops, "lamp-glow", LAMP_HEAD.x - 7, LAMP_HEAD.y + LAMP_HEAD.h);
    rect(ops, LAMP_HEAD.x, LAMP_HEAD.y, LAMP_HEAD.w, LAMP_HEAD.h, C.lampOn, "lamp-on");
    rect(ops, LAMP_HEAD.x + 1, LAMP_HEAD.y + LAMP_HEAD.h, LAMP_HEAD.w - 2, 1, C.bulb);
  } else {
    rect(ops, LAMP_HEAD.x, LAMP_HEAD.y, LAMP_HEAD.w, LAMP_HEAD.h, LAMP_OFF, "lamp-off");
  }
}

/** The server rack blinks while someone works in 작업. */
function rack(ops: Op[], actors: readonly Actor[], f: number) {
  if (!actors.some((a) => a.seated && a.person.zone === "run" && a.person.status === "working")) return;
  RACK_LEDS.forEach((led, i) => {
    if ((f + i * 3) % 4 !== 0) rect(ops, led.x, led.y, 1, 1, C.ledOn, "rack-led");
    if ((f * 2 + i) % 3 === 0) rect(ops, led.x + 2, led.y, 1, 1, C.lampOn, "rack-led");
  });
}

function beacon(ops: Op[], alarm: boolean, f: number) {
  if (alarm) {
    const bright = f % 2 === 0;
    if (bright) sprite(ops, "alarm-glow", BEACON.x + 2 - 12, BEACON.y + 2 - 12);
    const red = bright ? C.alarmOn : C.alarmDim;
    rect(ops, BEACON.x, BEACON.y, BEACON.w, BEACON.h, red, "alarm-on");
    rect(ops, BEACON.x + 1, BEACON.y - 1, BEACON.w - 2, 1, red);
    if (bright) rect(ops, BEACON.x + 1, BEACON.y + 1, 1, 1, "#ffc2bd");
  } else {
    rect(ops, BEACON.x, BEACON.y, BEACON.w, BEACON.h, BEACON_OFF, "alarm-off");
  }
}

/** A lit screen at a seat; what it shows depends on the zone and the person's status. */
function screen(ops: Op[], p: Person, box: Box, n: number) {
  const { x, y, w, h } = box;
  const bg = { plan: C.laptop, design: C.board, review: C.ide, build: C.ide, run: C.terminal }[p.zone];
  rect(ops, x, y, w, h, bg, `screen-${p.zone}`);
  const lines = Math.max(1, Math.floor((h - 1) / 2));
  if (p.status === "alert") {
    for (let line = 0; line < lines; line += 1) {
      const bad = line % 3 === 1;
      rect(ops, x + 1, y + 1 + line * 2, bad ? w - 2 : Math.max(2, Math.floor(w / 3) + ((line * 5) % 6)), 1, bad ? C.logError : C.logText, "error-log");
    }
    return;
  }
  if (p.status === "success") {
    for (let line = 0; line < lines - 1; line += 1) {
      rect(ops, x + 1, y + 1 + line * 2, Math.max(2, Math.floor(w / 3) + ((line * 7) % 8)), 1, C.logText);
    }
    rect(ops, x + 1, y + 1 + (lines - 1) * 2, Math.min(w - 2, 3), 1, C.ok, "ok");
    rect(ops, x + 5, y + 1 + (lines - 1) * 2, Math.max(1, w - 7), 1, C.ok, "ok");
    return;
  }
  if (p.status === "waiting") {
    // a prompt waiting for input
    rect(ops, x + 1, y + 1, 2, 1, C.ok, "prompt");
    rect(ops, x + 4, y + 1, Math.min(4, w - 5), 1, C.text, "prompt");
    return;
  }
  // working
  switch (p.zone) {
    case "build":
      code(ops, x, y, w, lines, n);
      break;
    case "run":
      if (p.agent === "claude") matrix(ops, box, n);
      else buildLog(ops, box, n);
      break;
    case "review":
      for (let line = 0; line < lines; line += 1) {
        const k = n + line;
        const c = k % 4 === 1 ? C.diffDel : k % 4 === 2 ? C.diffAdd : C.codeText;
        rect(ops, x + 1, y + 1 + line * 2, 1, 1, c, "diff");
        rect(ops, x + 3, y + 1 + line * 2, 3 + ((k * 5) % (w - 6)), 1, c, "diff");
      }
      break;
    case "design": {
      // a diagram drawn box by box, a line growing between them
      const t = n % 12;
      outlineOps(ops, x + 2, y + 2, 6, 4, C.boardLine, "drawing");
      if (t >= 4) outlineOps(ops, x + 12, y + 5, 6, 4, C.boardLine, "drawing");
      rect(ops, x + 8, y + 4, Math.min(4, Math.max(1, t - 1)), 1, C.boardLine, "drawing");
      rect(ops, x + 2 + (t % 8) * 2, y + h - 2, 1, 1, "#ffffff", "drawing");
      break;
    }
    case "plan":
      rect(ops, x + 1, y + 1, 2 + (n % 6), 1, C.text, "notes");
      rect(ops, x + 1, y + 3, 2 + ((n + 3) % 7), 1, C.codeText, "notes");
      break;
  }
}

/** Lines of code on a screen; `n` moves them along. */
function code(ops: Op[], x: number, y: number, w: number, lines: number, n: number) {
  for (let line = 0; line < lines; line += 1) {
    const k = n + line;
    const indent = [0, 2, 4, 4, 2, 0, 2][k % 7]!;
    const w1 = 2 + ((k * 5) % 3);
    const w2 = Math.max(1, Math.min(w - 4 - indent - w1, 2 + ((k * 3) % 6)));
    const cy = y + 1 + line * 2;
    rect(ops, x + 1 + indent, cy, w1, 1, C.code[k % C.code.length]!, "code");
    rect(ops, x + 2 + indent + w1, cy, w2, 1, C.codeText, "code");
  }
}

/** Falling green characters: a bright head and a trail. */
function matrix(ops: Op[], box: Box, n: number) {
  const { x, y, w, h } = box;
  for (let col = 0; col < Math.floor((w - 1) / 3); col += 1) {
    const cx = x + 1 + col * 3;
    const head = y + ((n * 2 + col * 7) % h);
    const top = Math.max(y, head - 4);
    if (head > top) rect(ops, cx, top, 1, head - top, C.matrixTail, "matrix");
    rect(ops, cx, head, 1, 1, C.matrixHead, "matrix");
  }
}

/** A build: a short log and a progress bar. */
function buildLog(ops: Op[], box: Box, n: number) {
  const { x, y, w, h } = box;
  for (let line = 0; line < Math.floor((h - 3) / 2); line += 1) {
    rect(ops, x + 2, y + 1 + line * 2, 4 + (((n + line) * 7) % (w - 8)), 1, C.codeText, "build-log");
  }
  rect(ops, x + 1, y + h - 2, w - 2, 1, "#2a3a55");
  rect(ops, x + 1, y + h - 2, 1 + (n % (w - 2)), 1, C.ok, "build-log");
}

function outlineOps(ops: Op[], x: number, y: number, w: number, h: number, c: string, tag: string) {
  rect(ops, x, y, w, 1, c, tag);
  rect(ops, x, y + h - 1, w, 1, c, tag);
  rect(ops, x, y + 1, 1, h - 2, c, tag);
  rect(ops, x + w - 1, y + 1, 1, h - 2, c, tag);
}

/**
 * The label bar: how many people of each kind, `+N` for those not drawn, and on the right
 * the statuses, most urgent first, in the colour of the most urgent one.
 */
function labels(ops: Op[], people: readonly Person[], hidden: number) {
  rect(ops, 0, ROOM_H, WIDTH, HEIGHT - ROOM_H, C.bar);
  rect(ops, 0, ROOM_H, WIDTH, 1, C.barLine);
  const y = ROOM_H + 10;
  if (people.length === 0) {
    ops.push({ kind: "text", x: 6, y, text: "사무실이 비어 있음", color: C.dim, tag: "label-people" });
  } else {
    let x = 6;
    const count = (agent: "codex" | "claude") => people.filter((p) => p.agent === agent && p.kind === "main").length;
    for (const [agent, name, color] of [
      ["codex", "Codex", C.codex],
      ["claude", "Claude", C.claude],
    ] as const) {
      const text = `${name} ${count(agent)}`;
      rect(ops, x, y - 5, 4, 4, color);
      ops.push({ kind: "text", x: x + 6, y, text, color: C.text, tag: "label-people" });
      x += 6 + textWidth(text) + 6;
    }
    const subs = people.filter((p) => p.kind === "sub").length;
    if (subs > 0) {
      const text = `서브 ${subs}`;
      ops.push({ kind: "text", x, y, text, color: C.text, tag: "label-people" });
      x += textWidth(text) + 6;
    }
    if (hidden > 0) {
      ops.push({ kind: "text", x, y, text: `+${hidden}`, color: C.lampOn, tag: "label-hidden" });
    }
    const parts = STATUS_ORDER.map((s) => [s, people.filter((p) => p.status === s).length] as const).filter(([, n]) => n > 0);
    // each status in its own colour, right-aligned, separated by dots
    const words = parts.map(([s, n]) => ({ text: `${STATUS_WORD[s]} ${n}`, color: STATUS_COLOR[s] }));
    const sep = "·";
    const gap = 3;
    let sx = WIDTH - 6 - words.reduce((sum, w, i) => sum + textWidth(w.text) + (i > 0 ? textWidth(sep) + 2 * gap : 0), 0);
    words.forEach((word, i) => {
      if (i > 0) {
        ops.push({ kind: "text", x: sx + gap, y, text: sep, color: C.dim });
        sx += textWidth(sep) + 2 * gap;
      }
      ops.push({ kind: "text", x: sx, y, text: word.text, color: word.color, tag: "label-status" });
      sx += textWidth(word.text);
    });
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
  for (let i = 0; i < 24; i += 1) {
    const x = ((i * 53 + 11) % (WIDTH - 4)) + 1;
    const y = 6 + ((i * 29 + f * 3) % (ROOM_H - 14));
    const wide = (i + Math.floor(f / 2)) % 2 === 0;
    rect(ops, x, y, wide ? 2 : 1, wide ? 1 : 2, colors[i % colors.length]!, "confetti");
  }
}
