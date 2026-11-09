/**
 * A tiny pixel painter for the sprite sheet (step 9b): rectangles, letter grids, blending and
 * a 3 x 5 pixel font, all into a plain colour array. Pure, so the art is tested in Node.
 */

export interface Sprite {
  w: number;
  h: number;
  /** Row-major colours (`#rrggbb`, or `#rrggbbaa` for see-through light), null for transparent. */
  px: (string | null)[];
}

const FONT: Record<string, string[]> = {
  A: ["010", "101", "111", "101", "101"],
  C: ["111", "100", "100", "100", "111"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  I: ["111", "010", "010", "010", "111"],
  L: ["100", "100", "100", "100", "111"],
  O: ["111", "101", "101", "101", "111"],
  P: ["111", "101", "111", "100", "100"],
  S: ["111", "100", "111", "001", "111"],
  X: ["101", "101", "010", "101", "101"],
  " ": ["000", "000", "000", "000", "000"],
};

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** Mixes colour `b` into colour `a` by `t` (0..1). Both `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** A small deterministic random source, so the art is the same on every load. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Painter {
  readonly px: (string | null)[];

  constructor(
    readonly w: number,
    readonly h: number,
    fill: string | null = null,
  ) {
    this.px = Array.from({ length: w * h }, () => fill);
  }

  set(x: number, y: number, c: string | null): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) {
      this.px[y * this.w + x] = c;
    }
  }

  get(x: number, y: number): string | null {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x]! : null;
  }

  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        this.set(x + dx, y + dy, c);
      }
    }
  }

  /** Mixes a colour over what is already there (glass, shadow, light). */
  blend(x: number, y: number, w: number, h: number, c: string, t: number): void {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        const old = this.get(x + dx, y + dy);
        if (old !== null) {
          this.set(x + dx, y + dy, mix(old.slice(0, 7), c, t));
        }
      }
    }
  }

  /** Letter grid: one key per pixel, `.` leaves the pixel alone. */
  grid(x: number, y: number, rows: readonly string[], palette: Record<string, string>): void {
    rows.forEach((row, dy) => {
      [...row].forEach((key, dx) => {
        if (key !== ".") {
          const c = palette[key];
          if (c === undefined) {
            throw new Error(`no colour for '${key}'`);
          }
          this.set(x + dx, y + dy, c);
        }
      });
    });
  }

  /** Upper-case text in the 3 x 5 pixel font, one pixel between letters. */
  text(x: number, y: number, s: string, c: string): void {
    [...s].forEach((ch, i) => {
      const glyph = FONT[ch];
      if (!glyph) {
        throw new Error(`no glyph for '${ch}'`);
      }
      glyph.forEach((row, dy) => {
        [...row].forEach((bit, dx) => {
          if (bit === "1") {
            this.set(x + i * 4 + dx, y + dy, c);
          }
        });
      });
    });
  }

  sprite(): Sprite {
    return { w: this.w, h: this.h, px: [...this.px] };
  }
}

/** Width in pixels of `s` in the 3 x 5 font. */
export function textWidth(s: string): number {
  return s.length * 4 - 1;
}
