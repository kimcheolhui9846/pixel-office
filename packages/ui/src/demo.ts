/**
 * The demo (`?demo` on the page): a fixed 20-second loop of fake events that walks through
 * all five scenes without any agent or server. Pure, so it is tested in Node.
 *
 *  0.0 s  Codex starts           -> CODEX_BUILDING
 *  4.0 s  Claude runs a tool     -> CLAUDE_RUNNING (the latest worker leads)
 *  8.0 s  Claude's tool fails    -> CLAUDE_ALERT (held 4 s)
 * 12.5 s  Codex stops            -> SUCCESS (held 4 s)
 * 16.5 s  nothing left           -> IDLE
 */
import {
  type AgentEvent,
  DEFAULT_TIMING,
  EMPTY_STATE,
  type OfficeState,
  reduce,
  scene,
  type Scene,
} from "@pixel-office/core";

export const DEMO_LOOP_MS = 20_000;

const SCRIPT: Omit<AgentEvent, "ts" | "cwd">[] = [
  { agent: "codex", sessionId: "demo-codex", type: "start" },
  { agent: "claude", sessionId: "demo-claude", type: "tool_start", detail: "Bash" },
  { agent: "claude", sessionId: "demo-claude", type: "error", detail: "Bash" },
  { agent: "codex", sessionId: "demo-codex", type: "stop" },
];
const AT = [0, 4_000, 8_000, 12_500];

export function demoState(elapsedMs: number): OfficeState {
  const t = ((elapsedMs % DEMO_LOOP_MS) + DEMO_LOOP_MS) % DEMO_LOOP_MS;
  let state = EMPTY_STATE;
  SCRIPT.forEach((e, i) => {
    const ts = AT[i]!;
    if (ts <= t) {
      state = reduce(state, { ...e, cwd: "demo", ts }, DEFAULT_TIMING);
    }
  });
  return reduce(state, { type: "tick", ts: t }, DEFAULT_TIMING);
}

export function demoScene(elapsedMs: number): Scene {
  return scene(demoState(elapsedMs));
}
