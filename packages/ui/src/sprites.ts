/**
 * The sprite sheet (steps 9, 9b and 9c): every character frame, prop and the office
 * background as pixel data written here, so there are no outside image assets. Pure data,
 * tested in Node.
 *
 * Character frames are named `<agent>/<pose>` for main sessions and `<agent>-sub/<pose>` for
 * subagents (see `figure.ts`). The page turns each sprite into a small canvas once (see
 * `sheet.ts`); another sheet (for example a PNG atlas) can replace this one by giving the
 * same names.
 */
import { type Agent, CHAR_H, CHAR_W, character, emptyChair, type Pose, POSES, SEATED_POSES, STANDING_POSES } from "./figure.js";
import { officeBackground } from "./office.js";
import { Painter, type Sprite } from "./pixels.js";

export type { Sprite } from "./pixels.js";
export { type Agent, CHAR_H, CHAR_W, type Pose, POSES, SEATED_POSES, STANDING_POSES };

/** The sprite name of a character frame. */
export function frameName(agent: Agent, sub: boolean, pose: Pose): string {
  return `${agent}${sub ? "-sub" : ""}/${pose}`;
}

function prop(rows: string[], palette: Record<string, string>): Sprite {
  const p = new Painter(rows[0]!.length, rows.length);
  p.grid(0, 0, rows, palette);
  return p.sprite();
}

/** A warm cone of light under the desk lamp, see-through (`#rrggbbaa`). */
function lampGlow(): Sprite {
  const w = 27;
  const h = 20;
  const p = new Painter(w, h);
  const cx = 10;
  for (let y = 0; y < h; y += 1) {
    const half = 2 + y * 0.6;
    for (let x = 0; x < w; x += 1) {
      const d = Math.abs(x - cx);
      if (d <= half) {
        p.set(x, y, `#ffd98a${d < half * 0.5 ? "40" : "26"}`);
      }
    }
  }
  return p.sprite();
}

/** A red halo around a warning light, in three see-through rings. */
function alarmGlow(): Sprite {
  const r = 12;
  const p = new Painter(r * 2 + 1, r * 2 + 1);
  for (let y = -r; y <= r; y += 1) {
    for (let x = -r; x <= r; x += 1) {
      const d = Math.sqrt(x * x + y * y);
      if (d <= r) {
        p.set(x + r, y + r, `#ff3b30${d < 5 ? "70" : d < 8.5 ? "40" : "20"}`);
      }
    }
  }
  return p.sprite();
}

/** The green PASS flag on a pole. */
function passFlag(): Sprite {
  const p = new Painter(24, 31);
  p.rect(0, 1, 2, 30, "#c9ced8");
  p.rect(1, 1, 1, 30, "#8e95a3");
  p.rect(0, 0, 2, 1, "#e2b964");
  p.rect(2, 2, 22, 11, "#2fb35a");
  p.rect(2, 2, 22, 1, "#4fd27a");
  p.rect(2, 12, 22, 1, "#23894a");
  p.set(23, 4, null);
  p.set(23, 5, null);
  p.set(22, 5, "#23894a");
  p.text(6, 5, "PASS", "#ffffff");
  return p.sprite();
}

// speech bubbles over a person's head: a question (waiting) and an alarm (alert)
const BUBBLE = { o: "#151821", w: "#f3f4f7", k: "#2a2230", r: "#e0352b", R: "#a4161a", W: "#ffffff" };
const bubbleWait = prop(
  [
    ".ooooooo.",
    "owwwwwwwo",
    "owwkkkwwo",
    "owkwwwkwo",
    "owwwwkkwo",
    "owwwkwwwo",
    "owwwwwwwo",
    "owwwkwwwo",
    ".ooowooo.",
    "...owo...",
    "...oo....",
  ],
  BUBBLE,
);
const bubbleAlert = prop(
  [
    ".ooooooo.",
    "orrrrrrro",
    "orrrWrrro",
    "orrrWrrro",
    "orrrWrrro",
    "orrrWrrro",
    "orrrrrrro",
    "orrrWrrro",
    ".ooorooo.",
    "...oro...",
    "...oo....",
  ],
  BUBBLE,
);

const PROPS: Record<string, Sprite> = {
  office: officeBackground(),
  chair: emptyChair(),
  "lamp-glow": lampGlow(),
  "alarm-glow": alarmGlow(),
  "pass-flag": passFlag(),
  "bubble-wait": bubbleWait,
  "bubble-alert": bubbleAlert,
};

/** Every sprite by name: `office`, `codex/type0`, `claude-sub/walk1`, ..., `pass-flag`. */
export const SPRITES: Readonly<Record<string, Sprite>> = (() => {
  const all: Record<string, Sprite> = { ...PROPS };
  for (const agent of ["codex", "claude"] as const) {
    for (const sub of [false, true]) {
      for (const pose of POSES) {
        all[frameName(agent, sub, pose)] = character(agent, pose, sub);
      }
    }
  }
  return all;
})();
