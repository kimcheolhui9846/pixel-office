/**
 * The sprite sheet (step 9): every character and prop as pixel data written here, so there
 * are no outside image assets. Pure data, tested in Node.
 *
 * Grids use one letter per pixel and `.` for transparent. Characters are put together from
 * parts (head, body, chair, arms per pose) and coloured per agent, giving one frame per
 * `<agent>/<pose>`. The page turns each sprite into a small canvas once (see `sheet.ts`);
 * another sheet (for example a PNG atlas) can replace this one by giving the same names.
 */

export interface Sprite {
  w: number;
  h: number;
  /** Row-major colours, null for transparent. */
  px: (string | null)[];
}

export type Agent = "codex" | "claude";
export type Pose = "rest" | "nod" | "type0" | "type1" | "fold" | "chin" | "head" | "cheer" | "coffee" | "worried";
export const POSES: readonly Pose[] = ["rest", "nod", "type0", "type1", "fold", "chin", "head", "cheer", "coffee", "worried"];

/** Character frames are 12 x 22: 5 rows of headroom for raised arms, then head, body, chair. */
export const CHAR_W = 12;
export const CHAR_H = 22;

const SHARED: Record<string, string> = {
  s: "#f1c27d", // skin
  k: "#22222a", // eyes, mouth
  c: "#495057", // chair
  C: "#343a40", // chair shade
  m: "#6f4e37", // mug
  w: "#f8f9fa", // white
  t: "#8ecae6", // sweat drop
};

const AGENT: Record<Agent, Record<string, string>> = {
  codex: { h: "#2b2d42", b: "#4361ee", d: "#3046b8", e: "#adb5bd" },
  claude: { h: "#6d4c41", b: "#e76f51", d: "#b9533b", e: "#6d4c41" },
};

const HEAD_BACK = ["..hhhh..", ".hhhhhh.", "hhhhhhhh", "shhhhhhs", "hhhhhhhh", ".hhhhhh.", "...ss..."];
// Codex wears headphones (band and ear cups), so the two backs differ at a glance
const HEADPHONES = ["..eeee..", ".e....e.", "........", "e......e", "e......e", "........", "........"];
const HEAD_FRONT = ["..hhhh..", ".hhhhhh.", "hhsssshh", "hskssksh", "hssssssh", ".sskkss.", "...ss..."];
const BODY_BACK = ["...dbbbbd...", "..bbbbbbbb..", "..bbbbbbbb..", "..bbbbbbbb..", "..bbbbbbbb..", "..dddddddd.."];
const BODY_FRONT = ["...dbwwbd...", "..bbbwwbbb..", "..bbbbbbbb..", "..bbbbbbbb..", "..bbbbbbbb..", "..dddddddd.."];
const CHAIR = [".cccccccccc.", ".CCCCCCCCCC.", "..C......C..", "..C......C.."];

type Rect = [x: number, y: number, w: number, h: number, key: string];

const REST_LEFT: Rect[] = [[1, 13, 1, 4, "b"], [1, 17, 1, 1, "s"]];
const REST_RIGHT: Rect[] = [[10, 13, 1, 4, "b"], [10, 17, 1, 1, "s"]];
const ARMS: Record<Pose, Rect[]> = {
  rest: [...REST_LEFT, ...REST_RIGHT],
  nod: [...REST_LEFT, ...REST_RIGHT],
  // reaching up to the keyboard on the desk, one hand higher than the other
  type0: [[1, 9, 1, 4, "b"], [1, 8, 1, 1, "s"], [10, 11, 1, 2, "b"], [10, 10, 1, 1, "s"]],
  type1: [[1, 11, 1, 2, "b"], [1, 10, 1, 1, "s"], [10, 9, 1, 4, "b"], [10, 8, 1, 1, "s"]],
  // arms folded: only the elbows show from behind
  fold: [[1, 13, 1, 3, "d"], [10, 13, 1, 3, "d"]],
  // chin on one hand, looking at the blueprint
  chin: [...REST_LEFT, [10, 12, 1, 3, "b"], [9, 11, 1, 1, "s"]],
  // hands on the head
  head: [[1, 7, 1, 6, "b"], [10, 7, 1, 6, "b"], [2, 5, 1, 2, "s"], [9, 5, 1, 2, "s"]],
  cheer: [[1, 3, 1, 9, "b"], [1, 1, 1, 2, "s"], [10, 3, 1, 9, "b"], [10, 1, 1, 2, "s"]],
  // a white cup of coffee held up beside the head, with a wisp of steam
  coffee: [...REST_LEFT, [10, 11, 1, 3, "b"], [10, 10, 2, 1, "s"], [10, 7, 2, 3, "w"], [10, 7, 2, 1, "m"], [11, 5, 1, 1, "t"]],
  worried: [...REST_LEFT, ...REST_RIGHT, [10, 5, 1, 2, "t"]],
};

function blank(w: number, h: number): string[] {
  return Array.from({ length: w * h }, () => ".");
}

function stamp(keys: string[], w: number, grid: string[], x: number, y: number): void {
  grid.forEach((row, dy) => {
    [...row].forEach((key, dx) => {
      if (key !== ".") {
        keys[(y + dy) * w + x + dx] = key;
      }
    });
  });
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
  stamp(keys, CHAR_W, CHAIR, 0, 18);
  stamp(keys, CHAR_W, front ? BODY_FRONT : BODY_BACK, 0, 12);
  const headY = pose === "nod" ? 6 : 5;
  stamp(keys, CHAR_W, front ? HEAD_FRONT : HEAD_BACK, 2, headY);
  if (agent === "codex" && !front) {
    stamp(keys, CHAR_W, HEADPHONES, 2, headY);
  }
  for (const [x, y, w, h, key] of ARMS[pose]) {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        keys[(y + dy) * CHAR_W + x + dx] = key;
      }
    }
  }
  return colour(keys, CHAR_W, CHAR_H, { ...SHARED, ...AGENT[agent] });
}

function prop(rows: string[], palette: Record<string, string>): Sprite {
  const w = rows[0]!.length;
  const keys = blank(w, rows.length);
  stamp(keys, w, rows, 0, 0);
  return colour(keys, w, rows.length, palette);
}

const PROPS: Record<string, Sprite> = {
  blueprint: prop(
    ["BBBBBBBBBBBB", "BwwwwBBwwwBB", "BwBBwBBwBwBB", "BwwwwBBwwwBB", "BBBBBBBBBBBB"],
    { B: "#1d4e89", w: "#cfe8ff" },
  ),
  plant: prop(
    ["...g....", ".g.gG.g.", ".gGgggG.", "gg.gG.gg", ".gggggg.", "..gGgg..", "...gg...", "..oooo..", ".oOOOOo.", ".oooooo.", "..oooo..", "..oooo.."],
    { g: "#2d6a4f", G: "#52b788", o: "#9c6644", O: "#7f5539" },
  ),
  mug: prop(["mmm.", "mmmm", "mmm."], { m: "#6f4e37" }),
};

/** Every sprite by name: `codex/type0`, `claude/cheer`, ..., `blueprint`, `plant`, `mug`. */
export const SPRITES: Readonly<Record<string, Sprite>> = (() => {
  const all: Record<string, Sprite> = { ...PROPS };
  for (const agent of ["codex", "claude"] as const) {
    for (const pose of POSES) {
      all[`${agent}/${pose}`] = character(agent, pose);
    }
  }
  return all;
})();
