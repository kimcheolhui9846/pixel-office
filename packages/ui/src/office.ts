/**
 * The office background (step 9b): everything that never moves, painted once into one
 * sprite (`office`). The page turns it into a canvas the first time and then draws it with
 * a single `drawImage`, so the detail costs nothing per frame. Things that change with the
 * scene (screens, the desk lamp, the warning light) are drawn over it by `art.ts` at the
 * places exported here.
 */
import { mix, Painter, rng, type Sprite, textWidth } from "./pixels.js";

/** The room above the label bar. */
export const ROOM_W = 240;
export const ROOM_H = 122;

/** Codex desk: three monitors on an arm. Screen rectangles are inside each bezel. */
export const CODEX_DESK = { x: 30, w: 99 } as const;
export const CODEX_MONITORS = [38, 64, 90] as const;
export const MONITOR = { y: 57, w: 24, h: 17 } as const;
export const SCREEN = { dx: 1, dy: 1, w: 22, h: 13 } as const;
export const LAMP_HEAD = { x: 116, y: 61, w: 7, h: 3 } as const;

/** Claude desk: one wide terminal and the warning light. */
export const CLAUDE_DESK = { x: 144, w: 69 } as const;
export const TERMINAL = { x: 163, y: 56, w: 28, h: 15 } as const;
export const BEACON = { x: 149, y: 70, w: 5, h: 5 } as const;

const DESK_TOP = 76;

const P = {
  ceiling: "#232838",
  ceilingEdge: "#1b1f2c",
  panel: "#f3f5fa",
  panelEdge: "#9aa3b8",
  wall: "#4d5773",
  wainscot: "#414a64",
  rail: "#66718f",
  railShade: "#363e56",
  skirting: "#2c3246",
  frame: "#9aa3b6",
  frameShade: "#6f788c",
  sill: "#c4cad6",
  sillShade: "#8d95a6",
  wood: "#b4875b",
  woodLight: "#c79a6c",
  woodDark: "#a07449",
  woodEdge: "#8c6240",
  woodShadow: "#5e412c",
  metal: "#5c6373",
  metalLight: "#6c7485",
  metalShade: "#4a505e",
  handle: "#b9bfca",
  bezel: "#1a1c24",
  bezelLight: "#2a2d37",
  screenOff: "#253042",
  glare: "#2e3a52",
  arm: "#3a3f4c",
  dark: "#2a2d36",
  white: "#e8eaef",
  black: "#000000",
} as const;

export const SCREEN_OFF = P.screenOff;
export const LAMP_OFF = "#4a4f5c";
export const BEACON_OFF = "#6b707d";

export function officeBackground(): Sprite {
  const p = new Painter(ROOM_W, ROOM_H, P.wall);
  ceiling(p);
  wall(p);
  windowView(p);
  floor(p);
  bookshelf(p);
  clock(p);
  cooler(p);
  sign(p);
  whiteboard(p);
  counter(p);
  meetingRoom(p);
  bin(p, 20, 98);
  codexDesk(p);
  claudeDesk(p);
  snakePlant(p, 3, 86);
  bushPlant(p, 216, 88);
  return p.sprite();
}

function ceiling(p: Painter) {
  p.rect(0, 0, ROOM_W, 4, P.ceiling);
  p.rect(0, 4, ROOM_W, 1, P.ceilingEdge);
  for (const x of [14, 74, 134, 194]) {
    p.rect(x, 1, 32, 2, P.panel);
    p.set(x - 1, 1, P.panelEdge);
    p.set(x - 1, 2, P.panelEdge);
    p.set(x + 32, 1, P.panelEdge);
    p.set(x + 32, 2, P.panelEdge);
  }
}

function wall(p: Painter) {
  p.rect(0, 5, ROOM_W, 43, P.wall);
  // soft light from the ceiling panels, fading down the wall
  for (const x of [14, 74, 134, 194]) {
    for (let i = 0; i < 8; i += 1) {
      p.blend(x - 4 + i, 5 + i, 40 - i * 2, 1, "#ffffff", 0.07 - i * 0.008);
    }
  }
  p.blend(0, 5, ROOM_W, 1, P.black, 0.25);
  p.rect(0, 38, ROOM_W, 10, P.wainscot);
  p.rect(0, 38, ROOM_W, 1, P.rail);
  p.rect(0, 39, ROOM_W, 1, P.railShade);
  for (let x = 10; x < ROOM_W; x += 20) {
    p.rect(x, 41, 1, 6, P.railShade);
  }
  p.rect(0, 48, ROOM_W, 2, P.skirting);
}

function windowView(p: Painter) {
  const x0 = 46;
  const y0 = 9;
  const w = 85;
  const h = 27;
  // sky
  for (let y = 0; y < h; y += 1) {
    const t = y / (h - 1);
    const c = t < 0.5 ? mix("#6d8ec0", "#9bb8db", t * 2) : mix("#9bb8db", "#c9d9ec", (t - 0.5) * 2);
    p.rect(x0, y0 + y, w, 1, c);
  }
  // clouds
  for (const [cx, cy, cw] of [
    [52, 15, 9],
    [86, 13, 12],
    [112, 17, 8],
  ] as const) {
    p.rect(cx, cy, cw, 2, "#e1e9f4");
    p.rect(cx + 2, cy - 1, cw - 5, 1, "#e1e9f4");
    p.rect(cx + 1, cy + 2, cw - 2, 1, "#c9d8ea");
  }
  const r = rng(7);
  // far towers, hazy
  for (let x = x0; x < x0 + w; ) {
    const bw = 5 + Math.floor(r() * 6);
    const bh = 9 + Math.floor(r() * 12);
    p.rect(x, y0 + h - bh, bw, bh, "#8ea7c6");
    p.rect(x, y0 + h - bh, 1, bh, "#9cb3cf");
    x += bw + Math.floor(r() * 3);
  }
  // near towers with window grids
  const tones = ["#4f6a8c", "#5a7596", "#46607f", "#536d8f"];
  for (let x = x0 - 2; x < x0 + w; ) {
    const bw = 7 + Math.floor(r() * 7);
    const bh = 6 + Math.floor(r() * 12);
    const top = y0 + h - bh;
    const tone = tones[Math.floor(r() * tones.length)]!;
    p.rect(x, top, bw, bh, tone);
    p.rect(x, top, bw, 1, mix(tone, "#ffffff", 0.25));
    p.rect(x + bw - 1, top + 1, 1, bh - 1, mix(tone, "#000000", 0.2));
    for (let wy = top + 2; wy < y0 + h - 1; wy += 3) {
      for (let wx = x + 1; wx < x + bw - 2; wx += 2) {
        p.set(wx, wy, r() < 0.12 ? "#f2d48a" : mix(tone, "#c9d9ec", 0.35));
      }
    }
    x += bw + Math.floor(r() * 2);
  }
  // keep the towers inside the glass
  p.rect(x0 - 2, y0, 2, h, P.frame);
  // glare
  for (let i = 0; i < 10; i += 1) {
    p.blend(x0 + 8 + i, y0 + 16 - i, 2, 1, "#ffffff", 0.18);
    p.blend(x0 + 60 + i, y0 + 20 - i, 1, 1, "#ffffff", 0.15);
  }
  // roller blinds pulled up
  p.rect(x0, y0, w, 3, "#dfe3ea");
  p.rect(x0, y0 + 1, w, 1, "#c4cad5");
  p.rect(x0, y0 + 3, w, 1, "#aab2c0");
  // frame and mullions
  p.rect(x0 - 2, y0 - 2, w + 4, 2, P.frame);
  p.rect(x0 - 2, y0, 2, h, P.frame);
  p.rect(x0 + w, y0, 2, h, P.frameShade);
  for (const mx of [x0 + 27, x0 + 56]) {
    p.rect(mx, y0, 2, h, P.frame);
    p.rect(mx + 1, y0, 1, h, P.frameShade);
  }
  p.rect(x0 - 4, y0 + h, w + 8, 2, P.sill);
  p.rect(x0 - 4, y0 + h + 2, w + 8, 1, P.sillShade);
}


function floor(p: Painter) {
  // carpet tiles, 12 x 12, the pile turned a quarter on every other tile
  for (let y = 50; y < ROOM_H; y += 1) {
    for (let x = 0; x < ROOM_W; x += 1) {
      const tx = Math.floor(x / 12);
      const ty = Math.floor((y - 50) / 12);
      const odd = (tx + ty) % 2 === 1;
      let c = odd ? "#474e61" : "#4a5165";
      if ((odd ? x % 3 : (y - 50) % 3) === 0) {
        c = odd ? "#454c5e" : "#484f62";
      }
      if (x % 12 === 0 || (y - 50) % 12 === 0) {
        c = "#40465a";
      }
      const n = (x * 73 + y * 151 + ((x * y) % 17)) % 41;
      if (n === 0) c = "#555c72";
      if (n === 7) c = "#3d4356";
      p.set(x, y, c);
    }
  }
  // shade where the floor meets the wall
  for (let i = 0; i < 4; i += 1) {
    p.blend(0, 50 + i, ROOM_W, 1, P.black, 0.3 - i * 0.07);
  }
}

function bookshelf(p: Painter) {
  const x = 2;
  const y = 12;
  const w = 30;
  const h = 48;
  p.rect(x, y, w, h, "#5b3f2c");
  p.rect(x, y, w, 1, "#7f5a3f");
  p.rect(x + w - 1, y, 1, h, "#4a3324");
  const books = ["#8c3b3b", "#2f5d7c", "#c2a14a", "#3f6b4a", "#6b4e7a", "#b0b5bf", "#a0522d", "#3b4a6b"];
  const r = rng(11);
  for (const sy of [y + 2, y + 12, y + 22]) {
    p.rect(x + 2, sy, w - 4, 8, "#2b211b");
    let bx = x + 2;
    while (bx < x + w - 3) {
      const bw = r() < 0.3 ? 3 : 2;
      const bh = 5 + Math.floor(r() * 3);
      if (r() < 0.12) {
        bx += 2; // a gap
        continue;
      }
      const c = books[Math.floor(r() * books.length)]!;
      const top = sy + 8 - bh;
      p.rect(bx, top, bw, bh, c);
      p.rect(bx, top, bw, 1, mix(c, "#ffffff", 0.3));
      p.rect(bx + bw - 1, top + 1, 1, bh - 1, mix(c, "#000000", 0.25));
      if (bw === 3) p.set(bx + 1, top + 3, "#e8e2cf");
      bx += bw;
    }
    // shelf board
    p.rect(x + 1, sy + 8, w - 2, 2, "#6e4c35");
    p.rect(x + 1, sy + 9, w - 2, 1, "#4a3324");
  }
  // binders on the bottom open shelf
  p.rect(x + 2, y + 32, w - 4, 2, "#2b211b");
  // closed cabinet
  const cy = y + 34;
  p.rect(x + 1, cy, w - 2, 13, "#6a4a34");
  p.rect(x + 1, cy, w - 2, 1, "#7f5a3f");
  p.rect(x + 15, cy, 1, 13, "#4a3324");
  p.rect(x + 12, cy + 5, 1, 3, "#c9b48a");
  p.rect(x + 18, cy + 5, 1, 3, "#c9b48a");
  p.rect(x, y + h - 1, w, 1, "#2a1d15");
  // a small plant on top
  p.rect(x + 20, y - 4, 6, 4, "#d6d2c9");
  p.rect(x + 20, y - 1, 6, 1, "#a9a49a");
  for (const [lx, ly] of [
    [21, -8],
    [23, -10],
    [25, -7],
    [19, -6],
    [27, -5],
  ] as const) {
    p.rect(x + lx, y + ly, 2, 4, "#3f8a57");
    p.set(x + lx, y + ly, "#5aab6c");
  }
}

function clock(p: Painter) {
  p.grid(34, 9, [
    "..kkkkk..",
    ".kwwwwwk.",
    "kwwwkwwwk",
    "kwwwkwwwk",
    "kwwwkkkwk",
    "kwwwwwwwk",
    "kwwwwwwwk",
    ".kwwwwwk.",
    "..kkkkk..",
  ], { k: "#2a2f40", w: "#eef1f6" });
}

function cooler(p: Painter) {
  const x = 34;
  p.grid(x, 21, [
    "...ccc...",
    "..bbbbb..",
    ".bBbbbbb.",
    ".bBbbbbd.",
    ".bBbbbbd.",
    ".bbbbbbd.",
    ".bbbbbbd.",
    "..bbbbb..",
    "...nnn...",
  ], { c: "#2f5f99", b: "#8fc1e3", B: "#cfe7f7", d: "#6fa6cf", n: "#6fa6cf" });
  p.rect(x, 30, 9, 30, "#dde2ea");
  p.rect(x, 30, 9, 1, "#c6ccd6");
  p.rect(x, 31, 1, 29, "#eef1f6");
  p.rect(x + 8, 31, 1, 29, "#b5bcc8");
  p.rect(x + 1, 35, 7, 7, "#9ba3b2");
  p.rect(x + 2, 36, 2, 2, "#d9534f");
  p.rect(x + 5, 36, 2, 2, "#4a8fd6");
  p.rect(x + 1, 41, 7, 1, "#7d8595");
  p.rect(x + 1, 46, 7, 1, "#b5bcc8");
  p.rect(x, 58, 9, 2, "#8d95a5");
}

function sign(p: Painter) {
  const text = "PIXEL OFFICE";
  const w = textWidth(text) + 6;
  const x = 163 - Math.floor(w / 2);
  p.blend(x + 1, 15, w, 1, P.black, 0.3);
  p.rect(x, 6, w, 9, "#262b3c");
  p.rect(x, 6, w, 1, "#3a4158");
  p.text(x + 3, 8, text, "#e2b964");
  // a small mark: two squares, one per agent colour
  p.rect(x - 7, 7, 3, 3, "#3d6fd6");
  p.rect(x - 5, 10, 3, 3, "#e2795a");
}

function whiteboard(p: Painter) {
  const x = 142;
  const y = 17;
  p.blend(x + 1, y + 1, 43, 15, P.black, 0.3);
  p.rect(x, y, 43, 14, "#aeb5c3");
  p.rect(x + 1, y + 1, 41, 12, "#eef1f6");
  const blue = "#3c6db5";
  const red = "#c84a4a";
  // a little flow chart
  outline(p, x + 3, y + 2, 8, 4, blue);
  p.rect(x + 11, y + 4, 4, 1, blue);
  p.set(x + 14, y + 3, blue);
  p.set(x + 14, y + 5, blue);
  outline(p, x + 15, y + 2, 8, 4, blue);
  p.rect(x + 19, y + 6, 1, 2, blue);
  outline(p, x + 15, y + 8, 8, 4, red);
  p.rect(x + 3, y + 8, 7, 1, "#5c6478");
  p.rect(x + 3, y + 10, 9, 1, "#5c6478");
  // sticky notes
  for (const [nx, ny, c] of [
    [x + 26, y + 2, "#f3d55b"],
    [x + 32, y + 3, "#f39bb0"],
    [x + 27, y + 7, "#9fd89a"],
    [x + 34, y + 8, "#f3d55b"],
  ] as const) {
    p.rect(nx, ny, 5, 4, c);
    p.rect(nx + 1, ny + 1, 3, 1, mix(c, "#000000", 0.35));
    p.rect(nx + 4, ny + 1, 1, 3, mix(c, "#000000", 0.15));
  }
  // marker tray
  p.rect(x + 4, y + 14, 35, 1, "#8a92a3");
  p.rect(x + 8, y + 13, 3, 1, red);
  p.rect(x + 12, y + 13, 3, 1, blue);
  p.rect(x + 16, y + 13, 3, 1, "#2a2d36");
}

function outline(p: Painter, x: number, y: number, w: number, h: number, c: string) {
  p.rect(x, y, w, 1, c);
  p.rect(x, y + h - 1, w, 1, c);
  p.rect(x, y, 1, h, c);
  p.rect(x + w - 1, y, 1, h, c);
}

function counter(p: Painter) {
  const x = 138;
  const w = 50;
  // coffee machine
  p.rect(x + 4, 33, 11, 9, "#2b2e37");
  p.rect(x + 4, 33, 11, 1, "#3d414d");
  p.rect(x + 6, 35, 7, 3, "#9aa1ae");
  p.set(x + 13, 34, "#e25555");
  p.rect(x + 8, 38, 2, 1, "#9aa1ae");
  p.rect(x + 7, 39, 4, 3, P.white);
  p.rect(x + 7, 39, 4, 1, "#6b4a35");
  // mugs
  p.rect(x + 18, 39, 3, 3, "#3d6fd6");
  p.rect(x + 22, 39, 3, 3, "#e2795a");
  // printer
  p.rect(x + 26, 35, 21, 7, "#d4d7dd");
  p.rect(x + 26, 35, 21, 1, "#e6e8ec");
  p.rect(x + 26, 41, 21, 1, "#a9aeb8");
  p.rect(x + 29, 37, 13, 2, "#5e6472");
  p.rect(x + 30, 36, 11, 1, "#fbfbfd");
  p.rect(x + 43, 36, 3, 2, "#3a3f4c");
  p.set(x + 44, 36, "#5ad17a");
  // counter
  p.rect(x, 42, w, 2, "#cfd3da");
  p.rect(x, 44, w, 1, "#9da4b1");
  p.rect(x, 45, w, 14, "#6b5242");
  for (let dx = 12; dx < w; dx += 12) {
    p.rect(x + dx, 45, 1, 14, "#59443a");
    p.rect(x + dx - 2, 49, 1, 3, "#c9b48a");
    p.rect(x + dx + 2, 49, 1, 3, "#c9b48a");
  }
  p.rect(x, 58, w, 2, P.skirting);
}

function meetingRoom(p: Painter) {
  const x = 190;
  const w = 50;
  p.rect(x, 5, w, 38, "#3b4560");
  p.rect(x, 36, w, 1, "#56607c");
  p.rect(x, 43, w, 16, "#535a6e");
  // screen with a chart
  p.rect(x + 12, 11, 24, 16, "#15171e");
  p.rect(x + 13, 12, 22, 13, "#2e4f7a");
  for (const [bx, bh, c] of [
    [x + 16, 5, "#6fa8dc"],
    [x + 20, 8, "#93c47d"],
    [x + 24, 6, "#6fa8dc"],
    [x + 28, 10, "#f6b26b"],
  ] as const) {
    p.rect(bx, 24 - bh, 3, bh, c);
  }
  p.rect(x + 14, 24, 20, 1, "#9fb6d4");
  // chairs behind the table
  for (const cx of [x + 9, x + 20, x + 31]) {
    p.rect(cx, 39, 7, 6, "#2a2e3a");
    p.rect(cx, 39, 7, 1, "#3d4250");
  }
  // table
  p.rect(x + 6, 45, 38, 6, "#8d6748");
  p.rect(x + 6, 45, 38, 1, "#a37a57");
  p.rect(x + 6, 51, 38, 2, "#6b4c35");
  p.rect(x + 10, 53, 2, 5, "#3a3f4c");
  p.rect(x + 38, 53, 2, 5, "#3a3f4c");
  // laptops and paper on the table
  p.rect(x + 12, 46, 6, 2, "#c4c8d0");
  p.rect(x + 30, 46, 6, 2, "#c4c8d0");
  p.rect(x + 22, 47, 4, 2, "#f2f3f6");
  // chairs in front
  for (const cx of [x + 13, x + 29]) {
    p.rect(cx, 52, 8, 6, "#2a2e3a");
    p.rect(cx, 52, 8, 1, "#3d4250");
  }
  // a plant in the corner
  p.rect(x + 42, 36, 5, 6, "#d6d2c9");
  for (const [lx, ly] of [
    [41, 30],
    [43, 28],
    [45, 31],
    [44, 33],
  ] as const) {
    p.rect(x + lx, ly, 2, 5, "#3f8a57");
  }
  // glass: tint, glare, a frosted band, aluminium frame
  p.blend(x, 5, w, 54, "#a8cbe8", 0.2);
  for (const gx of [x + 4, x + 24]) {
    for (let i = 0; i < 18; i += 1) {
      p.blend(gx + i, 26 - i, 3, 1, "#ffffff", 0.16);
      p.blend(gx + i + 6, 50 - i, 1, 1, "#ffffff", 0.12);
    }
  }
  p.blend(x, 29, w, 4, "#e6eef6", 0.5);
  p.rect(x, 5, w, 2, "#a9b1c0");
  p.rect(x, 5, 2, 54, "#a9b1c0");
  p.rect(x + 1, 7, 1, 52, "#7f8799");
  p.rect(x + 24, 5, 2, 54, "#a9b1c0");
  p.rect(x + 25, 7, 1, 52, "#7f8799");
  p.rect(x + w - 2, 5, 2, 54, "#a9b1c0");
  p.rect(x + 27, 36, 1, 8, "#e1e5eb");
  p.rect(x, 58, w, 2, "#8a92a3");
}

function bin(p: Painter, x: number, y: number) {
  p.blend(x, y + 10, 9, 2, P.black, 0.3);
  p.rect(x, y, 8, 10, "#3a3f4c");
  p.rect(x, y, 8, 1, "#565c6b");
  p.rect(x + 1, y + 1, 1, 9, "#474d5b");
  p.rect(x + 2, y - 1, 2, 1, P.white);
}

function pedestal(p: Painter, x: number, y: number, w: number, h: number) {
  p.rect(x, y, w, h, P.metal);
  p.rect(x, y, 1, h, P.metalLight);
  p.rect(x + w - 1, y, 1, h, P.metalShade);
  const third = Math.floor(h / 3);
  for (let i = 0; i < 3; i += 1) {
    const dy = y + i * third;
    if (i > 0) p.rect(x + 1, dy, w - 2, 1, "#444a58");
    p.rect(x + Math.floor(w / 2) - 2, dy + 2, 4, 1, P.handle);
  }
  p.rect(x, y + h - 1, w, 1, "#3a3f4c");
}

function deskBody(p: Painter, x: number, w: number) {
  p.blend(x + 2, 104, w - 2, 4, P.black, 0.28);
  p.rect(x, DESK_TOP, w, 8, P.wood);
  p.rect(x, DESK_TOP, w, 1, P.woodLight);
  const r = rng(x);
  for (let i = 0; i < 10; i += 1) {
    const gx = x + Math.floor(r() * (w - 12));
    const gy = DESK_TOP + 2 + Math.floor(r() * 5);
    p.rect(gx, gy, 6 + Math.floor(r() * 8), 1, P.woodDark);
  }
  p.rect(x, DESK_TOP + 8, w, 2, P.woodEdge);
  p.rect(x, DESK_TOP + 10, w, 1, P.woodShadow);
  pedestal(p, x + 2, 87, 18, 17);
  pedestal(p, x + w - 20, 87, 18, 17);
  p.rect(x + 20, 87, w - 40, 9, "#3b4151");
  p.rect(x + 20, 87, w - 40, 1, "#30353f");
}

function monitorBody(p: Painter, x: number, y: number, w: number, h: number) {
  p.rect(x, y, w, h, P.bezel);
  p.rect(x, y, w, 1, P.bezelLight);
  p.rect(x + 1, y + 1, w - 2, h - 4, P.screenOff);
  for (let i = 0; i < 5; i += 1) {
    p.set(x + 3 + i, y + h - 5 - i, P.glare);
    p.set(x + 4 + i, y + h - 5 - i, P.glare);
  }
  p.set(x + w - 3, y + h - 2, "#3fbf6f");
}

function codexDesk(p: Painter) {
  const { x, w } = CODEX_DESK;
  // the monitor arm: a pole and a bar behind the screens
  p.rect(76, 63, 2, DESK_TOP - 63, P.arm);
  p.rect(44, 65, 66, 2, P.arm);
  deskBody(p, x, w);
  CODEX_MONITORS.forEach((mx, i) => {
    monitorBody(p, mx, MONITOR.y, MONITOR.w, MONITOR.h);
    // the side screens turn inwards: a darker outer edge
    if (i === 0) p.rect(mx, MONITOR.y + 1, 1, MONITOR.h - 1, "#0f1016");
    if (i === 2) p.rect(mx + MONITOR.w - 1, MONITOR.y + 1, 1, MONITOR.h - 1, "#0f1016");
  });
  // keyboard, mouse pad, mouse
  p.rect(69, 79, 19, 3, P.dark);
  for (let kx = 70; kx < 87; kx += 2) {
    p.set(kx, 79, "#4b505e");
    p.set(kx + 1, 81, "#4b505e");
  }
  p.rect(90, 79, 8, 4, "#2f4f6f");
  p.rect(93, 80, 2, 2, P.dark);
  // papers and a mug
  p.rect(34, 78, 10, 4, "#d9dde4");
  p.rect(35, 77, 10, 4, "#f2f3f6");
  p.rect(37, 78, 6, 1, "#a9afbb");
  p.rect(37, 80, 5, 1, "#a9afbb");
  p.rect(104, 77, 4, 4, P.white);
  p.rect(104, 77, 4, 1, "#6b4a35");
  p.set(108, 78, P.white);
  p.set(108, 79, P.white);
  // desk lamp
  p.rect(120, 81, 8, 2, "#2f333e");
  p.rect(124, 64, 2, 17, "#2f333e");
  p.rect(121, 63, 5, 2, "#2f333e");
  p.rect(LAMP_HEAD.x, LAMP_HEAD.y, LAMP_HEAD.w, LAMP_HEAD.h, LAMP_OFF);
  p.rect(LAMP_HEAD.x + 1, LAMP_HEAD.y + LAMP_HEAD.h, LAMP_HEAD.w - 2, 1, "#3a3e49");
}

function claudeDesk(p: Painter) {
  const { x, w } = CLAUDE_DESK;
  deskBody(p, x, w);
  // terminal on a stand
  p.rect(175, 74, 4, 3, P.arm);
  p.rect(170, 77, 14, 2, "#2f333e");
  monitorBody(p, TERMINAL.x - 1, TERMINAL.y - 1, TERMINAL.w + 2, TERMINAL.h + 4);
  // a sticky note on the bezel
  p.rect(188, 55, 3, 3, "#f3d55b");
  // warning light: a dome on a base
  p.rect(BEACON.x - 2, 77, BEACON.w + 4, 2, P.dark);
  p.rect(BEACON.x - 2, 77, BEACON.w + 4, 1, "#4a4e5a");
  p.rect(BEACON.x - 1, 75, BEACON.w + 2, 2, "#8a909e");
  p.rect(BEACON.x, BEACON.y, BEACON.w, BEACON.h, BEACON_OFF);
  p.rect(BEACON.x + 1, BEACON.y - 1, BEACON.w - 2, 1, BEACON_OFF);
  p.set(BEACON.x + 1, BEACON.y + 1, "#9a9fab");
  // a stack of books
  for (const [by, c] of [
    [75, "#2f5d7c"],
    [73, "#8c3b3b"],
    [71, "#c2a14a"],
  ] as const) {
    p.rect(198, by, 11, 2, c);
    p.rect(198, by, 11, 1, mix(c, "#ffffff", 0.3));
    p.rect(207, by + 1, 1, 1, "#e8e2cf");
  }
  // phone
  p.rect(186, 80, 3, 2, P.dark);
}

function snakePlant(p: Painter, x: number, y: number) {
  // tall planter
  p.blend(x + 1, y + 34, 16, 2, P.black, 0.3);
  p.rect(x + 2, y + 20, 14, 15, "#cfd3da");
  p.rect(x + 2, y + 20, 14, 1, "#e6e8ec");
  p.rect(x + 2, y + 20, 1, 15, "#e6e8ec");
  p.rect(x + 14, y + 21, 2, 14, "#a9aeb8");
  p.rect(x + 3, y + 21, 11, 1, "#5a4636");
  // sword leaves
  const leaves: [number, number][] = [
    [4, 9],
    [6, 2],
    [8, 6],
    [10, 0],
    [12, 5],
    [14, 10],
  ];
  for (const [lx, top] of leaves) {
    const h = y + 21 - (y + top);
    p.rect(x + lx, y + top + 1, 2, h - 1, "#3f7d50");
    p.set(x + lx, y + top, "#3f7d50");
    p.rect(x + lx, y + top + 2, 1, h - 3, "#5c9e66");
    p.rect(x + lx + 1, y + top + 3, 1, h - 4, "#2e5e3e");
    for (let i = top + 4; i < 19; i += 4) {
      p.set(x + lx, y + i, "#8cc27e");
    }
  }
}

function bushPlant(p: Painter, x: number, y: number) {
  p.blend(x + 3, y + 32, 18, 2, P.black, 0.3);
  // round dark planter
  p.rect(x + 5, y + 20, 14, 13, "#3a3f4c");
  p.rect(x + 4, y + 19, 16, 2, "#4f5566");
  p.rect(x + 5, y + 21, 1, 12, "#4a5060");
  p.rect(x + 17, y + 21, 2, 12, "#2c303b");
  // leaves: dark blobs first, lighter ones up and to the left
  const blobs: [number, number, number, string][] = [
    [12, 13, 7, "#2e5e3e"],
    [6, 12, 5, "#2e5e3e"],
    [18, 11, 5, "#2e5e3e"],
    [11, 7, 6, "#3f7d50"],
    [6, 10, 4, "#3f7d50"],
    [17, 8, 4, "#3f7d50"],
    [10, 5, 3, "#5c9e66"],
    [15, 4, 3, "#5c9e66"],
    [5, 9, 2, "#5c9e66"],
    [9, 3, 1, "#8cc27e"],
    [14, 2, 1, "#8cc27e"],
  ];
  for (const [cx, cy, r, c] of blobs) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy <= r * r + r) {
          p.set(x + cx + dx, y + cy + dy, c);
        }
      }
    }
  }
}
