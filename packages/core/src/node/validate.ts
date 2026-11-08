/**
 * Strict checking of events posted to the server. Only the known fields are copied out;
 * everything else (prompt text, commands, tool output) is dropped here and never reaches
 * the state, the WebSocket or the log.
 */
import type { AgentEvent, AgentEventType, AgentKind } from "../state.js";

export const AGENTS: readonly AgentKind[] = ["codex", "claude"];
export const EVENT_TYPES: readonly AgentEventType[] = [
  "start",
  "tool_start",
  "tool_end",
  "waiting",
  "error",
  "success",
  "stop",
  "fs_burst",
];

export const LIMITS = { sessionId: 200, cwd: 1024, detail: 40 } as const;

export type Checked = { ok: true; event: AgentEvent } | { ok: false; reason: string };

/**
 * Checks a parsed JSON body. `ts` must be a finite number, but the server stamps events
 * with its own clock (see DESIGN.md section 6), so the value is not used.
 */
export function checkEvent(body: unknown, now: number): Checked {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.agent !== "string" || !(AGENTS as readonly string[]).includes(b.agent)) {
    return { ok: false, reason: "agent must be codex or claude" };
  }
  if (typeof b.type !== "string" || !(EVENT_TYPES as readonly string[]).includes(b.type)) {
    return { ok: false, reason: "unknown type" };
  }
  if (!isText(b.sessionId, 1, LIMITS.sessionId)) {
    return { ok: false, reason: `sessionId must be a string of 1-${LIMITS.sessionId} chars` };
  }
  if (!isText(b.cwd, 1, LIMITS.cwd)) {
    return { ok: false, reason: `cwd must be a string of 1-${LIMITS.cwd} chars` };
  }
  if (typeof b.ts !== "number" || !Number.isFinite(b.ts)) {
    return { ok: false, reason: "ts must be a number" };
  }
  if (b.detail !== undefined && !isText(b.detail, 0, LIMITS.detail)) {
    return { ok: false, reason: `detail must be a string of at most ${LIMITS.detail} chars` };
  }
  const event: AgentEvent = {
    agent: b.agent as AgentKind,
    type: b.type as AgentEventType,
    sessionId: b.sessionId as string,
    cwd: b.cwd as string,
    ts: now,
  };
  if (typeof b.detail === "string") {
    event.detail = b.detail;
  }
  return { ok: true, event };
}

// Control characters are refused: these strings reach the page and the session list, and there
// is no reason for a newline or NUL in an id, a path or a tool name.
function isText(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= min &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
