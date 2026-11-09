/**
 * Sprite sheet loader for the page (step 9), kept apart from the pixel data so another sheet
 * can replace it. Each sprite becomes a small canvas the first time it is drawn; after that a
 * frame is one `drawImage` per sprite.
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
    sprite.px.forEach((color, i) => {
      if (color !== null) {
        g.fillStyle = color;
        g.fillRect(i % sprite.w, Math.floor(i / sprite.w), 1, 1);
      }
    });
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
