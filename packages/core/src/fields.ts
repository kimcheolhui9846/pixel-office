/** Small helpers shared by the hook payload mappers (claude.ts, codex.ts). Browser-safe. */
import { LIMITS } from "./limits.js";

const CONTROL = /[\u0000-\u001f\u007f]/;

/** A string of 1..max characters without control characters, else undefined. */
export function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length >= 1 && value.length <= max && !CONTROL.test(value)
    ? value
    : undefined;
}

/** Control characters removed and cut to the server's detail limit without splitting a pair. */
export function shortLabel(value: string): string {
  let label = value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, LIMITS.detail);
  if (/[\ud800-\udbff]$/.test(label)) {
    label = label.slice(0, -1);
  }
  return label;
}
