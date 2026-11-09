/**
 * Sprite sheet loader for the page (step 9), kept apart from the pixel data so another sheet
 * can replace it. Each sprite becomes a small canvas the first time it is drawn; after that a
 * frame is one `drawImage` per sprite. Colours are `#rrggbb` or `#rrggbbaa`.
 */
import type { Sprite } from "./sprites.js";

export interface SpriteSheet {
  /** Draws a sprite with its top-left corner at (x, y) in logical pixels. */
  draw(ctx: CanvasRenderingContext2D, name: string, x: number, y: number): void;
}

/** A sheet made from pixel data such as `SPRITES`. Unknown names draw nothing. */
export function pixelSheet(sprites: Readonly<Record<string, Sprite>>): SpriteSheet {
  const cache = new Map<string, HTMLCanvasElement>();
  const image = (name: string): HTMLCanvasElement | undefined => {
    const hit = cache.get(name);
    if (hit) {
      return hit;
    }
    const sprite = sprites[name];
    if (!sprite) {
      return undefined;
    }
    const canvas = document.createElement("canvas");
    canvas.width = sprite.w;
    canvas.height = sprite.h;
    const g = canvas.getContext("2d")!;
    // one pass over the pixels (the office background alone is 240 x 122)
    const pixels = g.createImageData(sprite.w, sprite.h);
    sprite.px.forEach((color, i) => {
      if (color !== null) {
        pixels.data[i * 4] = parseInt(color.slice(1, 3), 16);
        pixels.data[i * 4 + 1] = parseInt(color.slice(3, 5), 16);
        pixels.data[i * 4 + 2] = parseInt(color.slice(5, 7), 16);
        pixels.data[i * 4 + 3] = color.length === 9 ? parseInt(color.slice(7, 9), 16) : 255;
      }
    });
    g.putImageData(pixels, 0, 0);
    cache.set(name, canvas);
    return canvas;
  };
  return {
    draw(ctx, name, x, y) {
      const canvas = image(name);
      if (canvas) {
        ctx.drawImage(canvas, x, y);
      }
    },
  };
}
