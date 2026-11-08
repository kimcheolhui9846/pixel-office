/** Reconnect delays for the live connection: 1 s, doubling, capped at 30 s. Pure. */
export const BACKOFF_START_MS = 1_000;
export const BACKOFF_CAP_MS = 30_000;

/** The delay before reconnect attempt `attempt` (0 for the first retry). */
export function backoffMs(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  // 2 ** 5 already passes the cap; keeping the exponent small avoids Infinity.
  return Math.min(BACKOFF_CAP_MS, BACKOFF_START_MS * 2 ** Math.min(n, 5));
}
