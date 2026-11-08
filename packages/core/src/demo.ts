/**
 * The demo: a fixed 20-second loop of fake events that walks through all five scenes
 * without any agent. The page uses it for `?demo` (no server), and `pixel-office simulate`
 * posts the same events to a running server. Pure and browser-safe.
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
} from "./state.js";

export const DEMO_LOOP_MS = 20_000;

/** The working directory the demo events carry. */
export const DEMO_CWD = "demo";

export interface DemoStep {
  /** Offset from the start of the loop, in milliseconds. */
  at: number;
  event: Omit<AgentEvent, "ts" | "cwd">;
}

export const DEMO_SCRIPT: readonly DemoStep[] = [
  { at: 0, event: { agent: "codex", sessionId: "demo-codex", type: "start" } },
  { at: 4_000, event: { agent: "claude", sessionId: "demo-claude", type: "tool_start", detail: "Bash" } },
  { at: 8_000, event: { agent: "claude", sessionId: "demo-claude", type: "error", detail: "Bash" } },
  { at: 12_500, event: { agent: "codex", sessionId: "demo-codex", type: "stop" } },
];

export function demoState(elapsedMs: number): OfficeState {
  const t = ((elapsedMs % DEMO_LOOP_MS) + DEMO_LOOP_MS) % DEMO_LOOP_MS;
  let state = EMPTY_STATE;
  for (const step of DEMO_SCRIPT) {
    if (step.at <= t) {
      state = reduce(state, { ...step.event, cwd: DEMO_CWD, ts: step.at }, DEFAULT_TIMING);
    }
  }
  return reduce(state, { type: "tick", ts: t }, DEFAULT_TIMING);
}

export function demoScene(elapsedMs: number): Scene {
  return scene(demoState(elapsedMs));
}
