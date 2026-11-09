/**
 * The sprite sheet (steps 9 and 9b): every character, prop and the office background as
 * pixel data written here, so there are no outside image assets. Pure data, tested in Node.
 *
 * Grids use one letter per pixel and `.` for transparent. Characters are put together from
 * parts (head, body, office chair, arms per pose), coloured per agent and given a dark
 * outline, one frame per `<agent>/<pose>`. The page turns each sprite into a small canvas
 * once (see `sheet.ts`); another sheet (for example a PNG atlas) can replace this one by
 * giving the same names.
 */
import { officeBackground } from "./office.js";
import { Painter, type Sprite } from "./pixels.js";

export type { Sprite } from "./pixels.js";

export type Agent = "codex" | "claude";
export type Pose = "rest" | "nod" | "type0" | "type1" | "fold" | "chin" | "head" | "cheer" | "coffee" | "worried";
export const POSES: readonly Pose[] = ["rest", "nod", "type0", "type1", "fold", "chin", "head", "cheer", "coffee", "worried"];

/**
 * Character frames are 20 x 32: 6 rows of headroom for raised arms, then head, shoulders,
 * an office chair with a back, a gas lift and wheels. Seen from behind except `worried`.
 */
export const CHAR_W = 20;
export const CHAR_H = 32;

const OUTLINE = "#151821";

const SHARED: Record<string, string> = {
  s: "#f2c79a", // skin
  S: "#d9a477", // skin shade
  k: "#2a2230", // eyes
  n: "#9c4a4a", // mouth
  c: "#3a3f4e", // chair
  C: "#2a2e3a", // chair shade
  x: "#565c6c", // chair highlight
  m: "#8a909e", // metal
  M: "#5e6472", // metal shade
  w: "#1d2029", // wheels
  W: "#f3f4f7", // white: collar, badge, mug
  q: "#6b4a35", // coffee
  t: "#8fd0f7", // sweat drop
  v: "#d8dde6", // steam
  p: "#3a3f52", // trousers
  P: "#2c3040", // trousers shade
  z: "#1d2029", // shoes
};

const AGENT: Record<Agent, Record<string, string>> = {
  // Codex: blue shirt, near-black hair, white headphones
  codex: { h: "#262a3d", L: "#3d4463", H: "#191c2a", b: "#3d6fd6", l: "#6b95ec", B: "#2a51a8", e: "#e4e8ef", E: "#9aa2b3" },
  // Claude: coral shirt, auburn hair in a bun with a gold tie
  claude: { h: "#7b4a30", L: "#a0653f", H: "#5a3321", b: "#e2795a", l: "#f3a283", B: "#b65640", e: "#f0c75e", E: "#c9a040" },
};

const HEAD_BACK = [
  "...hhhhhh...",
  "..hLLLhhhh..",
  ".hLLhhhhhhH.",
  ".hhhhhhhhhH.",
  ".hhhhhhhhHH.",
  ".shhhhhhhHs.",
  ".SHhhhhhHHS.",
  "..HHhhhhHH..",
  "....SssS....",
];
const HEAD_FRONT = [
  "...hhhhhh...",
  "..hLLLhhhh..",
  ".hLhhhhhhhH.",
  ".hhsssssshH.",
  ".hsksssksSH.",
  ".SsssssssSS.",
  "..SssnnsSS..",
  "...SSssSS...",
  "....SssS....",
];
// Codex wears headphones: a band over the head and a cup on each ear
const HEADPHONES = [
  "...EeeeeE...",
  "..E......E..",
  ".E........E.",
  ".e........e.",
  "ee........ee",
  "eE........Ee",
  "eE........Ee",
  "ee........ee",
  "............",
];
// Claude wears her hair in a bun, tied with a gold band
const BUN = ["....hLLh....", "...hLhhhH...", "....eEEe...."];

const BODY_BACK = [
  "......bbbbbbbb......",
  "....bllbbbbbbbbB....",
  "...bllbbbbbbbbbBB...",
  "...blbbbbbbbbbbBB...",
  "...bbbbbbbbbbbbBB...",
  "...bbbbbbbbbbbbBB...",
  "...bbbbbbbbbbbbBB...",
  "....BBBBBBBBBBBB....",
];
// from the front: a white collar and an ID badge
const BODY_FRONT = [
  "......bbWWWWbb......",
  "....bllbbWWbbbbB....",
  "...bllbbbbbbbbbBB...",
  "...blbbbbbbbbWWBB...",
  "...bbbbbbbbbbWWBB...",
  "...bbbbbbbbbbbbBB...",
  "...bbbbbbbbbbbbBB...",
  "....BBBBBBBBBBBB....",
];
const LEGS_FRONT = ["pppppppppp", "pPppppppPp", ".pp....pp.", ".pp....pp.", ".zz....zz."];
const BACKREST = [
  "..cccccccc..",
  ".cxxccccccC.",
  ".cxcccccccC.",
  ".cxcccccccC.",
  ".cccccccccC.",
  "..CCCCCCCC..",
];
const SEAT = ["cccccccccccccccc", ".CCCCCCCCCCCCCC."];
const COLUMN = ["mM", "mM"];
const BASE = ["MmmmmmmmmmmmmM", "ww....ww....ww"];

type Rect = [x: number, y: number, w: number, h: number, key: string];

const REST_LEFT: Rect[] = [[1, 17, 2, 5, "b"], [1, 17, 1, 5, "l"], [1, 22, 2, 1, "s"]];
const REST_RIGHT: Rect[] = [[17, 17, 2, 5, "b"], [18, 17, 1, 5, "B"], [17, 22, 2, 1, "s"]];
const ARMS: Record<Pose, Rect[]> = {
  rest: [...REST_LEFT, ...REST_RIGHT],
  nod: [...REST_LEFT, ...REST_RIGHT],
  // reaching forward to the keyboard, one hand higher than the other
  type0: [[2, 13, 2, 5, "b"], [2, 12, 2, 1, "s"], [16, 15, 2, 3, "b"], [17, 15, 1, 3, "B"], [16, 14, 2, 1, "s"]],
  type1: [[2, 15, 2, 3, "b"], [2, 14, 2, 1, "s"], [16, 13, 2, 5, "b"], [17, 13, 1, 5, "B"], [16, 12, 2, 1, "s"]],
  // arms folded: from behind only the elbows show, turned inwards
  fold: [[1, 17, 2, 3, "b"], [2, 20, 2, 1, "B"], [17, 17, 2, 3, "b"], [18, 17, 1, 3, "B"], [16, 20, 2, 1, "B"]],
  // chin on the right hand, elbow on the desk
  chin: [...REST_LEFT, [16, 13, 2, 5, "b"], [17, 13, 1, 5, "B"], [15, 11, 2, 2, "s"]],
  // both hands on the head
  head: [[1, 10, 2, 7, "b"], [3, 8, 2, 2, "s"], [17, 10, 2, 7, "b"], [18, 10, 1, 7, "B"], [15, 8, 2, 2, "s"]],
  cheer: [[2, 3, 2, 13, "b"], [2, 3, 1, 13, "l"], [2, 1, 2, 2, "s"], [16, 3, 2, 13, "b"], [17, 3, 1, 13, "B"], [16, 1, 2, 2, "s"]],
  // a white mug of coffee held up beside the head, with steam
  coffee: [
    ...REST_LEFT,
    [17, 14, 2, 4, "b"],
    [18, 14, 1, 4, "B"],
    [17, 13, 2, 1, "s"],
    [16, 9, 3, 4, "W"],
    [16, 9, 3, 1, "q"],
    [19, 10, 1, 2, "W"],
    [17, 6, 1, 2, "v"],
    [18, 4, 1, 2, "v"],
  ],
  worried: [...REST_LEFT, ...REST_RIGHT, [16, 6, 1, 2, "t"], [3, 8, 1, 2, "t"]],
};

function blank(w: number, h: number): string[] {
  return Array.from({ length: w * h }, () => ".");
}

function stamp(keys: string[], w: number, grid: readonly string[], x: number, y: number): void {
  grid.forEach((row, dy) => {
    [...row].forEach((key, dx) => {
      if (key !== ".") {
        keys[(y + dy) * w + x + dx] = key;
      }
    });
  });
}

/** A dark line around the figure (not around steam), so it reads on any background. */
function outline(keys: string[], w: number, h: number): void {
  const solid = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const k = keys[y * w + x]!;
    return k !== "." && k !== "o" && k !== "v";
  };
  const edge: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (keys[y * w + x] === "." && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) {
        edge.push(y * w + x);
      }
    }
  }
  for (const i of edge) keys[i] = "o";
}

function colour(keys: string[], w: number, h: number, palette: Record<string, string>): Sprite {
  return {
    w,
    h,
    px: keys.map((key) => {
      if (key === ".") {
        return null;
      }
      const c = palette[key];
      if (c === undefined) {
        throw new Error(`no colour for '${key}'`);
      }
      return c;
    }),
  };
}

/** One character frame. */
export function character(agent: Agent, pose: Pose): Sprite {
  const keys = blank(CHAR_W, CHAR_H);
  const front = pose === "worried";
  const headY = pose === "nod" ? 7 : 6;
  stamp(keys, CHAR_W, SEAT, 2, 25);
  stamp(keys, CHAR_W, COLUMN, 9, 27);
  stamp(keys, CHAR_W, BASE, 3, 29);
  if (front) {
    stamp(keys, CHAR_W, BACKREST, 4, 20);
    stamp(keys, CHAR_W, BODY_FRONT, 0, 15);
    stamp(keys, CHAR_W, LEGS_FRONT, 5, 23);
  } else {
    stamp(keys, CHAR_W, BODY_BACK, 0, 15);
    stamp(keys, CHAR_W, BACKREST, 4, 20);
  }
  if (agent === "claude") {
    stamp(keys, CHAR_W, BUN, 4, headY - 2);
  }
  stamp(keys, CHAR_W, front ? HEAD_FRONT : HEAD_BACK, 4, headY);
  if (agent === "codex") {
    stamp(keys, CHAR_W, HEADPHONES, 4, headY);
  }
  for (const [x, y, w, h, key] of ARMS[pose]) {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        keys[(y + dy) * CHAR_W + x + dx] = key;
      }
    }
  }
  outline(keys, CHAR_W, CHAR_H);
  return colour(keys, CHAR_W, CHAR_H, { ...SHARED, ...AGENT[agent], o: OUTLINE });
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

const PROPS: Record<string, Sprite> = {
  office: officeBackground(),
  blueprint: prop(
    [
      "bBBBBBBBBBBBBBBBRr",
      "bBwwwwwwBBBwwwwBRr",
      "bBwBBBBwBBBwBBwBRr",
      "bBwBBBBwwwwwBBwBRr",
      "bBwwwwwwBBBwwwwBRr",
      "bBBBBBBBBBBBBBBBRr",
      "bbbbbbbbbbbbbbbbRr",
    ],
    { b: "#1a4378", B: "#2563a8", w: "#cfe6ff", R: "#4f8ad0", r: "#2a5a99" },
  ),
  "lamp-glow": lampGlow(),
  "alarm-glow": alarmGlow(),
  "pass-flag": passFlag(),
};

/** Every sprite by name: `office`, `codex/type0`, `claude/cheer`, ..., `blueprint`, `pass-flag`. */
export const SPRITES: Readonly<Record<string, Sprite>> = (() => {
  const all: Record<string, Sprite> = { ...PROPS };
  for (const agent of ["codex", "claude"] as const) {
    for (const pose of POSES) {
      all[`${agent}/${pose}`] = character(agent, pose);
    }
  }
  return all;
})();
