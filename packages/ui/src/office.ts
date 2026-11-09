/**
 * The office background (steps 9b and 9c): everything that never moves, painted once into
 * one sprite (`office`). The page turns it into a canvas the first time and then draws it
 * with a single `drawImage`, so the detail costs nothing per frame. Things that change with
 * the scene (screens, the desk lamp, the warning light, the door, the rack lights) are drawn
 * over it by `art.ts` at the places exported here.
 *
 * Step 9c divides the floor into five work zones (see `floor.ts`), each with its own
 * furniture and a sign: 기획 a meeting table under a whiteboard, 설계 drafting boards under a
 * wall display, 검토 a reading desk with review screens by the window and a bookshelf,
 * 구현 a bench of dev desks with two monitors each, 작업 terminals, a test bench and a
 * server rack. Every seat has an empty chair, so a free seat reads as free.
 */
import type { Zone } from "@pixel-office/core";

import { emptyChair } from "./figure.js";
import { type Point, ROOM_H, ROOM_W, SEATS, ZONE_AREAS } from "./floor.js";
import { mix, Painter, rng, type Sprite, textWidth } from "./pixels.js";

export { ROOM_H, ROOM_W } from "./floor.js";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the wall meets the floor. */
const FLOOR_Y = 47;
const BACK_TOP = 66;
const FRONT_TOP = 124;

export const LAMP_HEAD: Box = { x: 143, y: 108, w: 7, h: 3 };
export const BEACON: Box = { x: 116, y: 13, w: 5, h: 5 };
/** The door leaf, drawn dark (open) while someone walks through. */
export const DOOR_LEAF: Box = { x: 5, y: 18, w: 15, h: 29 };
const RACK = { x: 174, y: 98, w: 20, h: 54 } as const;
/** The status lights on the server rack, one per server unit. */
export const RACK_LEDS: readonly Point[] = Array.from({ length: 7 }, (_, i) => ({ x: RACK.x + 14, y: RACK.y + 5 + i * 7 }));

/** Zone signs: a plate in the background, the Korean name drawn on it by `art.ts`. */
export interface Sign {
  zone: Zone;
  x: number;
  y: number;
  w: number;
  h: number;
}
const SIGN_W = 25;
export const SIGNS: readonly Sign[] = Object.values(ZONE_AREAS).map((a) =>
  a.row === "back"
    ? { zone: a.zone, x: a.x + 3, y: 6, w: SIGN_W, h: 10 }
    : { zone: a.zone, x: a.x + a.w - SIGN_W - 3, y: 154, w: SIGN_W, h: 10 },
);

/** The screens at a seat (inside the bezels), lit by `art.ts` while someone works there. */
export function seatScreens(zone: Zone, seat: Point): Box[] {
  const c = seat.x + 10;
  switch (zone) {
    case "plan":
      return [{ x: seat.x + 5, y: 58, w: 10, h: 5 }];
    case "design":
      return [{ x: seat.x, y: 48, w: 20, h: 11 }];
    case "review":
      return [{ x: seat.x + 1, y: 48, w: 18, h: 10 }];
    case "build":
      return [
        { x: c - 16, y: 107, w: 14, h: 9 },
        { x: c + 2, y: 107, w: 14, h: 9 },
      ];
    case "run":
      return [{ x: c - 13, y: 106, w: 26, h: 12 }];
  }
}

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
/** The drafting boards' paper when nobody draws on them. */
export const BOARD_OFF = "#24507f";

export function officeBackground(): Sprite {
  const p = new Painter(ROOM_W, ROOM_H, P.wall);
  ceiling(p);
  wall(p);
  floor(p);
  zoneFloors(p);
  door(p);
  sign(p);
  beaconMount(p);
  // 기획: whiteboard, clock, meeting table with laptops
  whiteboard(p, 34, 18, 62, 18);
  clock(p, 101, 20);
  meetingTable(p);
  // 설계: wall display with a diagram, drafting boards
  wallDisplay(p);
  draftingBoards(p);
  // 검토: window, bookshelf, reading desk with review screens
  windowView(p, 252, 18, 32, 18);
  bookshelf(p, 289, 9);
  readingDesk(p);
  bushPlant(p, -2, 58);
  chairs(p, ["plan", "design", "review"]);
  // front row: 구현 dev desks, 작업 terminals and the server rack
  devDesks(p);
  serverRack(p);
  terminalDesks(p);
  chairs(p, ["build", "run"]);
  signs(p);
  return p.sprite();
}

function ceiling(p: Painter) {
  p.rect(0, 0, ROOM_W, 4, P.ceiling);
  p.rect(0, 4, ROOM_W, 1, P.ceilingEdge);
  for (const x of [20, 100, 180, 260]) {
    p.rect(x, 1, 40, 2, P.panel);
    p.set(x - 1, 1, P.panelEdge);
    p.set(x - 1, 2, P.panelEdge);
    p.set(x + 40, 1, P.panelEdge);
    p.set(x + 40, 2, P.panelEdge);
  }
}

function wall(p: Painter) {
  p.rect(0, 5, ROOM_W, FLOOR_Y - 5, P.wall);
  // soft light from the ceiling panels, fading down the wall
  for (const x of [20, 100, 180, 260]) {
    for (let i = 0; i < 8; i += 1) {
      p.blend(x - 4 + i, 5 + i, 48 - i * 2, 1, "#ffffff", 0.07 - i * 0.008);
    }
  }
  p.blend(0, 5, ROOM_W, 1, P.black, 0.25);
  p.rect(0, 37, ROOM_W, 8, P.wainscot);
  p.rect(0, 37, ROOM_W, 1, P.rail);
  p.rect(0, 38, ROOM_W, 1, P.railShade);
  for (let x = 10; x < ROOM_W; x += 20) {
    p.rect(x, 40, 1, 4, P.railShade);
  }
  p.rect(0, 45, ROOM_W, 2, P.skirting);
}

function floor(p: Painter) {
  // carpet tiles, 12 x 12, the pile turned a quarter on every other tile
  for (let y = FLOOR_Y; y < ROOM_H; y += 1) {
    for (let x = 0; x < ROOM_W; x += 1) {
      const tx = Math.floor(x / 12);
      const ty = Math.floor((y - FLOOR_Y) / 12);
      const odd = (tx + ty) % 2 === 1;
      let c = odd ? "#474e61" : "#4a5165";
      if ((odd ? x % 3 : (y - FLOOR_Y) % 3) === 0) {
        c = odd ? "#454c5e" : "#484f62";
      }
      if (x % 12 === 0 || (y - FLOOR_Y) % 12 === 0) {
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
    p.blend(0, FLOOR_Y + i, ROOM_W, 1, P.black, 0.3 - i * 0.07);
  }
}

/** Each zone gets a faint tint of its colour and a line of floor tape around it. */
function zoneFloors(p: Painter) {
  for (const area of Object.values(ZONE_AREAS)) {
    const y = area.row === "back" ? FLOOR_Y + 2 : 100;
    const h = area.row === "back" ? 43 : 55;
    const x = area.x + 1;
    const w = area.w - 2;
    p.blend(x, y, w, h, area.color, 0.06);
    const tape = (tx: number, ty: number, tw: number, th: number) => p.blend(tx, ty, tw, th, area.color, 0.35);
    tape(x, y + h - 1, w, 1);
    tape(x, y, 1, h - 1);
    tape(x + w - 1, y, 1, h - 1);
    if (area.row === "front") tape(x, y, w, 1);
  }
}

function door(p: Painter) {
  // frame, leaf with a small window, handle, mat
  p.blend(3, 16, 20, 31, P.black, 0.2);
  p.rect(3, 15, 19, 32, "#8d95a6");
  p.rect(4, 16, 17, 31, "#6f788c");
  p.rect(DOOR_LEAF.x, DOOR_LEAF.y, DOOR_LEAF.w, DOOR_LEAF.h, "#8c6a4a");
  p.rect(DOOR_LEAF.x, DOOR_LEAF.y, DOOR_LEAF.w, 1, "#a37d58");
  p.rect(DOOR_LEAF.x + DOOR_LEAF.w - 1, DOOR_LEAF.y, 1, DOOR_LEAF.h, "#6e5139");
  p.rect(8, 21, 9, 8, "#2a2f3c");
  p.rect(9, 22, 7, 6, "#9bb8db");
  p.blend(9, 22, 3, 6, "#ffffff", 0.25);
  p.rect(DOOR_LEAF.x + DOOR_LEAF.w - 4, 33, 2, 1, P.handle);
  p.rect(DOOR_LEAF.x + DOOR_LEAF.w - 4, 34, 1, 1, P.handle);
  p.rect(DOOR_LEAF.x + 2, 38, DOOR_LEAF.w - 5, 6, "#7d5d40");
  // exit sign
  p.rect(4, 8, 17, 7, "#1f6b3a");
  p.rect(4, 8, 17, 1, "#2f8a4f");
  p.text(5, 9, "EXIT", "#eafbea");
  // mat
  p.rect(3, FLOOR_Y + 1, 19, 3, "#3b3229");
  p.rect(4, FLOOR_Y + 2, 17, 1, "#4a3f33");
}

function sign(p: Painter) {
  const text = "PIXEL OFFICE";
  const w = textWidth(text) + 6;
  const x = 172 - Math.floor(w / 2);
  p.blend(x + 1, 15, w, 1, P.black, 0.3);
  p.rect(x, 6, w, 9, "#262b3c");
  p.rect(x, 6, w, 1, "#3a4158");
  p.text(x + 3, 8, text, "#e2b964");
  // a small mark: two squares, one per agent colour
  p.rect(x - 7, 7, 3, 3, "#3d6fd6");
  p.rect(x - 5, 10, 3, 3, "#e2795a");
}

function beaconMount(p: Painter) {
  const { x, y, w, h } = BEACON;
  p.rect(x - 1, y + h, w + 2, 2, "#8a909e");
  p.rect(x - 2, y + h + 2, w + 4, 1, P.dark);
  p.rect(x, y, w, h, BEACON_OFF);
  p.rect(x + 1, y - 1, w - 2, 1, BEACON_OFF);
  p.set(x + 1, y + 1, "#9a9fab");
}

function signs(p: Painter) {
  for (const s of SIGNS) {
    const color = ZONE_AREAS[s.zone].color;
    p.blend(s.x + 1, s.y + s.h, s.w, 1, P.black, 0.35);
    p.rect(s.x, s.y, s.w, s.h, "#262b3c");
    p.rect(s.x, s.y, s.w, 1, "#3a4158");
    p.rect(s.x + 2, s.y + 3, 4, 4, color);
    p.rect(s.x + 2, s.y + 3, 4, 1, mix(color, "#ffffff", 0.35));
  }
}

function whiteboard(p: Painter, x: number, y: number, w: number, h: number) {
  p.blend(x + 1, y + 1, w + 1, h + 1, P.black, 0.3);
  p.rect(x, y, w, h, "#aeb5c3");
  p.rect(x + 1, y + 1, w - 2, h - 2, "#eef1f6");
  const blue = "#3c6db5";
  const red = "#c84a4a";
  // a little flow chart
  outline(p, x + 3, y + 2, 8, 4, blue);
  p.rect(x + 11, y + 4, 4, 1, blue);
  p.set(x + 14, y + 3, blue);
  p.set(x + 14, y + 5, blue);
  outline(p, x + 15, y + 2, 8, 4, blue);
  p.rect(x + 19, y + 6, 1, 3, blue);
  outline(p, x + 15, y + 9, 8, 4, red);
  p.rect(x + 3, y + 8, 7, 1, "#5c6478");
  p.rect(x + 3, y + 10, 9, 1, "#5c6478");
  p.rect(x + 3, y + 12, 6, 1, "#5c6478");
  // a timeline
  p.rect(x + 27, y + 4, 18, 1, "#5c6478");
  for (const [tx, c] of [
    [27, blue],
    [33, blue],
    [39, red],
    [44, "#2f9e55"],
  ] as const) {
    p.rect(x + tx, y + 3, 2, 3, c);
  }
  // sticky notes
  for (const [nx, ny, c] of [
    [x + 27, y + 8, "#f3d55b"],
    [x + 33, y + 9, "#f39bb0"],
    [x + 39, y + 8, "#9fd89a"],
    [x + 48, y + 3, "#f3d55b"],
    [x + 54, y + 6, "#9fd89a"],
    [x + 49, y + 10, "#f39bb0"],
  ] as const) {
    p.rect(nx, ny, 5, 4, c);
    p.rect(nx + 1, ny + 1, 3, 1, mix(c, "#000000", 0.35));
    p.rect(nx + 4, ny + 1, 1, 3, mix(c, "#000000", 0.15));
  }
  // marker tray
  p.rect(x + 4, y + h, w - 8, 1, "#8a92a3");
  p.rect(x + 8, y + h - 1, 3, 1, red);
  p.rect(x + 12, y + h - 1, 3, 1, blue);
  p.rect(x + 16, y + h - 1, 3, 1, "#2a2d36");
}

function outline(p: Painter, x: number, y: number, w: number, h: number, c: string) {
  p.rect(x, y, w, 1, c);
  p.rect(x, y + h - 1, w, 1, c);
  p.rect(x, y, 1, h, c);
  p.rect(x + w - 1, y, 1, h, c);
}

function clock(p: Painter, x: number, y: number) {
  p.grid(x, y, [
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

function meetingTable(p: Painter) {
  const x = 29;
  const w = 86;
  p.blend(x + 2, 90, w - 2, 3, P.black, 0.28);
  // legs, then the top
  for (const lx of [x + 3, x + w - 6]) {
    p.rect(lx, BACK_TOP + 9, 3, 15, "#3a3f4c");
    p.rect(lx, BACK_TOP + 9, 1, 15, "#4b5160");
  }
  p.rect(x + 8, BACK_TOP + 9, w - 16, 2, "#3a3f4c");
  p.rect(x, BACK_TOP, w, 7, "#8d6748");
  p.rect(x, BACK_TOP, w, 1, "#a37a57");
  const r = rng(x);
  for (let i = 0; i < 8; i += 1) {
    p.rect(x + 2 + Math.floor(r() * (w - 14)), BACK_TOP + 2 + Math.floor(r() * 4), 5 + Math.floor(r() * 7), 1, "#7d5a3e");
  }
  p.rect(x, BACK_TOP + 7, w, 2, "#6b4c35");
  // a laptop at every seat
  for (const seat of SEATS.plan) {
    const lx = seat.x + 4;
    p.rect(lx, 57, 12, 7, "#c4c8d0");
    p.rect(lx, 57, 12, 1, "#d6d9df");
    p.rect(lx + 1, 58, 10, 5, P.screenOff);
    p.rect(lx - 1, 64, 14, 2, "#a9aeb8");
  }
  // papers, a jug and cups between the seats
  p.rect(56, 63, 4, 3, "#f2f3f6");
  p.rect(57, 64, 2, 1, "#a9afbb");
  p.rect(84, 61, 3, 5, "#cfe7f7");
  p.rect(84, 61, 3, 1, "#8fc1e3");
  p.rect(110, 63, 3, 3, "#3d6fd6");
  p.rect(30, 63, 3, 3, "#e2795a");
}

function wallDisplay(p: Painter) {
  const x = 138;
  const y = 18;
  const w = 68;
  const h = 18;
  p.blend(x + 1, y + h, w, 1, P.black, 0.3);
  p.rect(x, y, w, h, P.bezel);
  p.rect(x, y, w, 1, P.bezelLight);
  p.rect(x + 1, y + 1, w - 2, h - 3, "#16263d");
  // an architecture diagram: boxes and the lines between them
  const boxes: [number, number, number, string][] = [
    [4, 3, 10, "#6fa8dc"],
    [4, 9, 10, "#6fa8dc"],
    [26, 6, 14, "#93c47d"],
    [52, 3, 11, "#f6b26b"],
    [52, 9, 11, "#c792ea"],
  ];
  for (const [bx, by, bw, c] of boxes) {
    outline(p, x + bx, y + by, bw, 4, c);
    p.rect(x + bx + 2, y + by + 2, bw - 5, 1, mix(c, "#16263d", 0.4));
  }
  const line = "#9fb6d4";
  p.rect(x + 14, y + 5, 6, 1, line);
  p.rect(x + 14, y + 11, 6, 1, line);
  p.rect(x + 20, y + 5, 1, 7, line);
  p.rect(x + 20, y + 8, 6, 1, line);
  p.rect(x + 40, y + 8, 6, 1, line);
  p.rect(x + 46, y + 5, 1, 7, line);
  p.rect(x + 46, y + 5, 6, 1, line);
  p.rect(x + 46, y + 11, 6, 1, line);
  p.set(x + w - 3, y + h - 2, "#3fbf6f");
}

function draftingBoards(p: Painter) {
  for (const seat of SEATS.design) {
    const x = seat.x;
    // stand: two legs and a foot bar behind the chair
    p.rect(x + 1, 61, 2, 29, "#3a3f4c");
    p.rect(x + 17, 61, 2, 29, "#3a3f4c");
    p.rect(x + 1, 82, 18, 1, "#3a3f4c");
    // the tilted board: wooden frame, blueprint paper, a grid
    p.blend(x - 1, 61, 24, 2, P.black, 0.25);
    p.rect(x - 2, 46, 24, 15, "#c79a6c");
    p.rect(x - 2, 46, 24, 1, "#d8b083");
    p.rect(x - 2, 60, 24, 1, "#8c6240");
    p.rect(x, 48, 20, 11, BOARD_OFF);
    for (let gx = x + 3; gx < x + 20; gx += 4) p.rect(gx, 48, 1, 11, "#2c5c8f");
    for (let gy = 50; gy < 59; gy += 3) p.rect(x, gy, 20, 1, "#2c5c8f");
    // a pencil tray
    p.rect(x - 1, 61, 22, 1, "#8c6240");
    p.rect(x + 3, 60, 4, 1, "#f0c75e");
  }
}

function windowView(p: Painter, x0: number, y0: number, w: number, h: number) {
  // sky
  for (let y = 0; y < h; y += 1) {
    const t = y / (h - 1);
    const c = t < 0.5 ? mix("#6d8ec0", "#9bb8db", t * 2) : mix("#9bb8db", "#c9d9ec", (t - 0.5) * 2);
    p.rect(x0, y0 + y, w, 1, c);
  }
  p.rect(x0 + 4, y0 + 6, 8, 2, "#e1e9f4");
  p.rect(x0 + 6, y0 + 5, 4, 1, "#e1e9f4");
  const r = rng(7);
  for (let x = x0; x < x0 + w; ) {
    const bw = 4 + Math.floor(r() * 5);
    const bh = 6 + Math.floor(r() * 8);
    p.rect(x, y0 + h - bh, Math.min(bw, x0 + w - x), bh, "#8ea7c6");
    x += bw + Math.floor(r() * 3);
  }
  const tones = ["#4f6a8c", "#5a7596", "#46607f", "#536d8f"];
  for (let x = x0; x < x0 + w; ) {
    const bw = Math.min(6 + Math.floor(r() * 6), x0 + w - x);
    const bh = 4 + Math.floor(r() * 9);
    const top = y0 + h - bh;
    const tone = tones[Math.floor(r() * tones.length)]!;
    p.rect(x, top, bw, bh, tone);
    p.rect(x, top, bw, 1, mix(tone, "#ffffff", 0.25));
    for (let wy = top + 2; wy < y0 + h - 1; wy += 3) {
      for (let wx = x + 1; wx < x + bw - 1; wx += 2) {
        p.set(wx, wy, r() < 0.12 ? "#f2d48a" : mix(tone, "#c9d9ec", 0.35));
      }
    }
    x += bw + Math.floor(r() * 2);
  }
  for (let i = 0; i < 8; i += 1) {
    p.blend(x0 + 6 + i, y0 + 14 - i, 2, 1, "#ffffff", 0.18);
  }
  // blinds pulled up, frame, a mullion and the sill
  p.rect(x0, y0, w, 3, "#dfe3ea");
  p.rect(x0, y0 + 1, w, 1, "#c4cad5");
  p.rect(x0, y0 + 3, w, 1, "#aab2c0");
  p.rect(x0 - 2, y0 - 2, w + 4, 2, P.frame);
  p.rect(x0 - 2, y0, 2, h, P.frame);
  p.rect(x0 + w, y0, 2, h, P.frameShade);
  p.rect(x0 + Math.floor(w / 2) - 1, y0, 2, h, P.frame);
  p.rect(x0 + Math.floor(w / 2), y0, 1, h, P.frameShade);
  p.rect(x0 - 4, y0 + h, w + 8, 2, P.sill);
  p.rect(x0 - 4, y0 + h + 2, w + 8, 1, P.sillShade);
}

function bookshelf(p: Painter, x: number, y: number) {
  const w = 29;
  const h = 40;
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
    p.rect(x + 1, sy + 8, w - 2, 2, "#6e4c35");
    p.rect(x + 1, sy + 9, w - 2, 1, "#4a3324");
  }
  // closed cabinet at the bottom
  const cy = y + 32;
  p.rect(x + 1, cy, w - 2, h - 33, "#6a4a34");
  p.rect(x + 1, cy, w - 2, 1, "#7f5a3f");
  p.rect(x + 14, cy, 1, h - 33, "#4a3324");
  p.rect(x + 12, cy + 3, 1, 2, "#c9b48a");
  p.rect(x + 16, cy + 3, 1, 2, "#c9b48a");
  p.rect(x, y + h - 1, w, 1, "#2a1d15");
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

/** A wooden desk top at `top` with drawer pedestals under both ends and legs between. */
function deskBody(p: Painter, x: number, w: number, top: number, legs: readonly number[] = []) {
  p.blend(x + 2, top + 28, w - 2, 3, P.black, 0.28);
  p.rect(x, top, w, 8, P.wood);
  p.rect(x, top, w, 1, P.woodLight);
  const r = rng(x + top);
  for (let i = 0; i < Math.floor(w / 9); i += 1) {
    const gx = x + Math.floor(r() * (w - 12));
    const gy = top + 2 + Math.floor(r() * 5);
    p.rect(gx, gy, 6 + Math.floor(r() * 8), 1, P.woodDark);
  }
  p.rect(x, top + 8, w, 2, P.woodEdge);
  p.rect(x, top + 10, w, 1, P.woodShadow);
  p.rect(x + 2, top + 11, w - 4, 8, "#3b4151");
  p.rect(x + 2, top + 11, w - 4, 1, "#30353f");
  pedestal(p, x + 2, top + 11, 16, 17);
  pedestal(p, x + w - 18, top + 11, 16, 17);
  for (const lx of legs) {
    p.rect(lx, top + 11, 3, 17, "#3a3f4c");
    p.rect(lx, top + 11, 1, 17, "#4b5160");
  }
}

function monitorBody(p: Painter, x: number, y: number, w: number, h: number) {
  p.rect(x, y, w, h, P.bezel);
  p.rect(x, y, w, 1, P.bezelLight);
  p.rect(x + 1, y + 1, w - 2, h - 4, P.screenOff);
  for (let i = 0; i < 4; i += 1) {
    p.set(x + 3 + i, y + h - 5 - i, P.glare);
    p.set(x + 4 + i, y + h - 5 - i, P.glare);
  }
  p.set(x + w - 3, y + h - 2, "#3fbf6f");
}

function readingDesk(p: Painter) {
  deskBody(p, 221, 92, BACK_TOP);
  for (const seat of SEATS.review) {
    p.rect(seat.x + 9, 61, 2, 5, P.arm);
    p.rect(seat.x + 6, 65, 8, 1, "#2f333e");
    monitorBody(p, seat.x, 47, 20, 14);
  }
  // books and a reading lamp between the screens
  for (const [by, c] of [
    [64, "#2f5d7c"],
    [62, "#8c3b3b"],
    [60, "#c2a14a"],
  ] as const) {
    p.rect(246, by, 8, 2, c);
    p.rect(246, by, 8, 1, mix(c, "#ffffff", 0.3));
  }
  p.rect(276, 64, 4, 2, "#2f333e");
  p.rect(277, 54, 1, 10, "#2f333e");
  p.rect(275, 52, 5, 2, "#2f333e");
  // an open binder of printouts with red marks
  p.rect(303, 63, 9, 3, "#f2f3f6");
  p.rect(307, 63, 1, 3, "#c4c8d0");
  p.rect(304, 64, 2, 1, "#c84a4a");
  p.rect(309, 64, 2, 1, "#5c6478");
}

function devDesks(p: Painter) {
  deskBody(p, 4, 147, FRONT_TOP, [50, 100]);
  for (const seat of SEATS.build) {
    const c = seat.x + 10;
    // two monitors on one arm
    p.rect(c - 1, 119, 2, 5, P.arm);
    p.rect(c - 12, 120, 24, 1, P.arm);
    monitorBody(p, c - 17, 106, 16, 13);
    monitorBody(p, c + 1, 106, 16, 13);
    // a mug and a notebook beside the screens
    p.rect(c + 19, 120, 3, 3, P.white);
    p.rect(c + 19, 120, 3, 1, "#6b4a35");
    p.rect(c - 23, 121, 5, 3, "#f2f3f6");
    p.rect(c - 22, 122, 3, 1, "#a9afbb");
  }
  // a small cactus on the middle desk
  p.rect(96, 119, 4, 5, "#c56a4a");
  p.rect(97, 114, 2, 5, "#3f8a57");
  p.rect(96, 116, 1, 2, "#3f8a57");
  // desk lamp at the right end
  p.rect(145, 124, 6, 2, "#2f333e");
  p.rect(148, 111, 2, 13, "#2f333e");
  p.rect(146, 110, 4, 2, "#2f333e");
  p.rect(LAMP_HEAD.x, LAMP_HEAD.y, LAMP_HEAD.w, LAMP_HEAD.h, LAMP_OFF);
  p.rect(LAMP_HEAD.x + 1, LAMP_HEAD.y + LAMP_HEAD.h, LAMP_HEAD.w - 2, 1, "#3a3e49");
}

function serverRack(p: Painter) {
  const { x, y, w, h } = RACK;
  p.blend(x + 2, y + h, w, 2, P.black, 0.35);
  p.rect(x, y, w, h, "#1f2229");
  p.rect(x, y, w, 1, "#3a3f4c");
  p.rect(x, y, 1, h, "#30343f");
  p.rect(x + w - 1, y, 1, h, "#15171c");
  RACK_LEDS.forEach((led, i) => {
    const uy = led.y - 2;
    p.rect(x + 2, uy, w - 4, 5, i % 3 === 2 ? "#3a3f4c" : "#2e323c");
    p.rect(x + 2, uy, w - 4, 1, "#454a57");
    for (let vx = x + 4; vx < x + 12; vx += 2) p.rect(vx, uy + 2, 1, 2, "#1a1c22");
    p.set(led.x, led.y, "#2a5a3a");
    p.set(led.x + 2, led.y, "#2a5a3a");
  });
  p.rect(x + 1, y + h - 3, w - 2, 3, "#2a2d36");
}

function terminalDesks(p: Painter) {
  deskBody(p, 198, 119, FRONT_TOP, [236, 276]);
  for (const seat of SEATS.run) {
    const c = seat.x + 10;
    p.rect(c - 2, 120, 4, 4, P.arm);
    p.rect(c - 6, 123, 12, 1, "#2f333e");
    monitorBody(p, c - 14, 105, 28, 16);
  }
  // test bench: an oscilloscope with a green trace, a circuit board with probes
  p.rect(230, 113, 11, 11, "#c4c8d0");
  p.rect(230, 113, 11, 1, "#dfe2e7");
  p.rect(231, 114, 7, 6, "#0b1510");
  p.rect(231, 117, 2, 1, "#5ad17a");
  p.rect(233, 116, 2, 1, "#5ad17a");
  p.rect(235, 118, 2, 1, "#5ad17a");
  p.rect(239, 115, 1, 1, "#e25555");
  p.rect(239, 118, 1, 1, "#4a8fd6");
  p.rect(270, 121, 11, 3, "#2f7a4a");
  p.rect(272, 121, 3, 2, "#1a1c22");
  p.rect(277, 122, 2, 1, "#c9b48a");
  p.rect(269, 118, 1, 4, "#e25555");
  p.rect(282, 117, 1, 5, "#1a1c22");
}

function chairs(p: Painter, zones: readonly Zone[]) {
  const chair = emptyChair();
  for (const zone of zones) {
    for (const seat of SEATS[zone]) {
      p.blend(seat.x + 3, seat.y + 30, 15, 2, P.black, 0.25);
      p.blit(chair, seat.x, seat.y);
    }
  }
}

function bushPlant(p: Painter, x: number, y: number) {
  p.blend(x + 3, y + 32, 18, 2, P.black, 0.3);
  p.rect(x + 5, y + 20, 14, 13, "#3a3f4c");
  p.rect(x + 4, y + 19, 16, 2, "#4f5566");
  p.rect(x + 5, y + 21, 1, 12, "#4a5060");
  p.rect(x + 17, y + 21, 2, 12, "#2c303b");
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
