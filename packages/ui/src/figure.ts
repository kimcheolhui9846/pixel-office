/**
 * People (steps 9, 9b and 9c): every character frame put together from parts (head, body,
 * office chair, arms per pose, legs when standing), coloured per agent and given a dark
 * outline. Pure data, tested in Node.
 *
 * Seated frames are seen from behind (except `worried`); standing and walking frames face
 * the viewer. Subagents ("interns") are two pixels shorter, wear a lighter shirt, and swap
 * the headphones (Codex) or the bun (Claude) for a beanie or a ponytail; standing, they wear
 * a green lanyard.
 */
import { mix, type Sprite } from "./pixels.js";

export type Agent = "codex" | "claude";
export type SeatedPose = "rest" | "nod" | "type0" | "type1" | "fold" | "chin" | "head" | "cheer" | "coffee" | "worried" | "raise";
export type StandingPose = "stand" | "walk0" | "walk1" | "hooray";
export type Pose = SeatedPose | StandingPose;
export const SEATED_POSES: readonly SeatedPose[] = ["rest", "nod", "type0", "type1", "fold", "chin", "head", "cheer", "coffee", "worried", "raise"];
export const STANDING_POSES: readonly StandingPose[] = ["stand", "walk0", "walk1", "hooray"];
export const POSES: readonly Pose[] = [...SEATED_POSES, ...STANDING_POSES];

/**
 * Frames are 20 x 32. Seated: 6 rows of headroom for raised arms, then head, shoulders, an
 * office chair with a back, a gas lift and wheels. Standing: head, body, legs and shoes.
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
  g: "#3fbf6f", // lanyard
};

const AGENT: Record<Agent, Record<string, string>> = {
  // Codex: blue shirt, near-black hair, white headphones
  codex: { h: "#262a3d", L: "#3d4463", H: "#191c2a", b: "#3d6fd6", l: "#6b95ec", B: "#2a51a8", e: "#e4e8ef", E: "#9aa2b3" },
  // Claude: coral shirt, auburn hair in a bun with a gold tie
  claude: { h: "#7b4a30", L: "#a0653f", H: "#5a3321", b: "#e2795a", l: "#f3a283", B: "#b65640", e: "#f0c75e", E: "#c9a040" },
};

/** An intern's palette: the same colours, the shirt washed lighter. */
function subPalette(agent: Agent): Record<string, string> {
  const a = AGENT[agent];
  return { ...a, b: mix(a.b!, "#ffffff", 0.3), l: mix(a.l!, "#ffffff", 0.3), B: mix(a.B!, "#ffffff", 0.2), u: a.B!, U: mix(a.B!, "#000000", 0.25) };
}

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
];
// Claude wears her hair in a bun, tied with a gold band
const BUN = ["....hLLh....", "...hLhhhH...", "....eEEe...."];
// a Codex intern wears a beanie in the team colour
const BEANIE = ["....uuuu....", "..uuuuuuuu..", ".uuuuuuuuuU.", ".UUUUUUUUUU."];
// a Claude intern ties her hair in a short ponytail
const PONYTAIL = ["....ee....", "....hh....", "....hH....", ".....H...."];

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
// an intern's lanyard and pass instead of the badge
const BODY_FRONT_SUB = [
  "......bbWWWWbb......",
  "....bllbgWWgbbbB....",
  "...bllbbgbbgbbbBB...",
  "...blbbbbggbbbbBB...",
  "...bbbbbgWWgbbbBB...",
  "...bbbbbggggbbbBB...",
  "...bbbbbbbbbbbbBB...",
  "....BBBBBBBBBBBB....",
];
const LEGS_FRONT = ["pppppppppp", "pPppppppPp", ".pp....pp.", ".pp....pp.", ".zz....zz."];

/** The empty office chair, also drawn into the background at every free seat. */
export const BACKREST = [
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
const ARMS: Record<SeatedPose, Rect[]> = {
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
  // one hand up: a question for the user
  raise: [...REST_LEFT, [16, 3, 2, 13, "b"], [17, 3, 1, 13, "B"], [16, 1, 2, 2, "s"]],
};

function blank(w: number, h: number): string[] {
  return Array.from({ length: w * h }, () => ".");
}

function stamp(keys: string[], w: number, grid: readonly string[], x: number, y: number): void {
  grid.forEach((row, dy) => {
    [...row].forEach((key, dx) => {
      if (key !== "." && y + dy >= 0) {
        keys[(y + dy) * w + x + dx] = key;
      }
    });
  });
}

function fill(keys: string[], rects: readonly Rect[], dy = 0): void {
  for (const [x, y, w, h, key] of rects) {
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) {
        const yy = y + j + dy;
        if (yy >= 0 && yy < CHAR_H) keys[yy * CHAR_W + x + i] = key;
      }
    }
  }
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

function chairKeys(keys: string[]): void {
  stamp(keys, CHAR_W, SEAT, 2, 25);
  stamp(keys, CHAR_W, COLUMN, 9, 27);
  stamp(keys, CHAR_W, BASE, 3, 29);
}

/** The empty chair, in the same 20 x 32 frame as a seated person. */
export function emptyChair(): Sprite {
  const keys = blank(CHAR_W, CHAR_H);
  stamp(keys, CHAR_W, BACKREST, 4, 20);
  chairKeys(keys);
  outline(keys, CHAR_W, CHAR_H);
  return colour(keys, CHAR_W, CHAR_H, { ...SHARED, o: OUTLINE });
}

function hair(keys: string[], agent: Agent, sub: boolean, headY: number, front: boolean): void {
  if (sub) {
    stamp(keys, CHAR_W, agent === "codex" ? BEANIE : [], 4, headY - 1);
    if (agent === "claude" && !front) stamp(keys, CHAR_W, PONYTAIL, 5, headY + 6);
  } else {
    if (agent === "claude") stamp(keys, CHAR_W, BUN, 4, headY - 2);
  }
}

function seated(agent: Agent, pose: SeatedPose, sub: boolean): string[] {
  const keys = blank(CHAR_W, CHAR_H);
  const front = pose === "worried";
  const dy = sub ? 2 : 0; // interns are a little shorter
  const headY = (pose === "nod" ? 7 : 6) + dy;
  chairKeys(keys);
  if (front) {
    stamp(keys, CHAR_W, BACKREST, 4, 20);
    stamp(keys, CHAR_W, sub ? BODY_FRONT_SUB : BODY_FRONT, 0, 15 + dy);
    stamp(keys, CHAR_W, LEGS_FRONT, 5, 23);
  } else {
    stamp(keys, CHAR_W, BODY_BACK, 0, 15 + dy);
    stamp(keys, CHAR_W, BACKREST, 4, 20);
  }
  if (!sub && agent === "claude") hair(keys, agent, sub, headY, front);
  stamp(keys, CHAR_W, front ? HEAD_FRONT : HEAD_BACK, 4, headY);
  if (sub) hair(keys, agent, sub, headY, front);
  if (!sub && agent === "codex") stamp(keys, CHAR_W, HEADPHONES, 4, headY);
  fill(keys, ARMS[pose], dy);
  return keys;
}

function standing(agent: Agent, pose: StandingPose, sub: boolean): string[] {
  const keys = blank(CHAR_W, CHAR_H);
  const headY = sub ? 6 : 4;
  const by = headY + 9; // body top
  const ly = by + 8; // hips
  const n = CHAR_H - 2 - (ly + 2); // leg rows between hips and shoes
  const legs: Rect[] = [[5, ly, 10, 2, "p"], [13, ly + 1, 1, 1, "P"]];
  if (pose === "walk0") {
    legs.push([5, ly + 2, 3, n, "p"], [7, ly + 2, 1, n, "P"], [12, ly + 2, 3, n - 1, "p"], [14, ly + 2, 1, n - 1, "P"]);
    legs.push([4, ly + 2 + n, 4, 2, "z"], [12, ly + 1 + n, 4, 2, "z"]);
  } else if (pose === "walk1") {
    legs.push([6, ly + 2, 3, n - 1, "p"], [8, ly + 2, 1, n - 1, "P"], [11, ly + 2, 3, n, "p"], [13, ly + 2, 1, n, "P"]);
    legs.push([5, ly + 1 + n, 4, 2, "z"], [11, ly + 2 + n, 4, 2, "z"]);
  } else {
    legs.push([6, ly + 2, 3, n, "p"], [8, ly + 2, 1, n, "P"], [11, ly + 2, 3, n, "p"], [13, ly + 2, 1, n, "P"]);
    legs.push([5, ly + 2 + n, 4, 2, "z"], [11, ly + 2 + n, 4, 2, "z"]);
  }
  fill(keys, legs);
  stamp(keys, CHAR_W, sub ? BODY_FRONT_SUB : BODY_FRONT, 0, by);
  if (!sub && agent === "claude") hair(keys, agent, sub, headY, true);
  stamp(keys, CHAR_W, HEAD_FRONT, 4, headY);
  if (sub) hair(keys, agent, sub, headY, true);
  if (!sub && agent === "codex") stamp(keys, CHAR_W, HEADPHONES, 4, headY);
  const arm = (x: number, len: number, light: string): Rect[] => [
    [x, by + 2, 2, len, "b"],
    [x === 1 ? 1 : 18, by + 2, 1, len, light],
    [x, by + 2 + len, 2, 1, "s"],
  ];
  if (pose === "hooray") {
    fill(keys, [[2, by - 9, 2, 11, "b"], [2, by - 9, 1, 11, "l"], [2, by - 11, 2, 2, "s"], [16, by - 9, 2, 11, "b"], [17, by - 9, 1, 11, "B"], [16, by - 11, 2, 2, "s"]]);
  } else {
    // arms swing with the legs: the arm coming forward looks shorter
    const left = pose === "walk1" ? 7 : pose === "walk0" ? 5 : 6;
    const right = pose === "walk0" ? 7 : pose === "walk1" ? 5 : 6;
    fill(keys, [...arm(1, left, "l"), ...arm(17, right, "B")]);
  }
  return keys;
}

/** One character frame. */
export function character(agent: Agent, pose: Pose, sub = false): Sprite {
  const keys = (SEATED_POSES as readonly string[]).includes(pose)
    ? seated(agent, pose as SeatedPose, sub)
    : standing(agent, pose as StandingPose, sub);
  outline(keys, CHAR_W, CHAR_H);
  return colour(keys, CHAR_W, CHAR_H, { ...SHARED, ...(sub ? subPalette(agent) : AGENT[agent]), o: OUTLINE });
}
