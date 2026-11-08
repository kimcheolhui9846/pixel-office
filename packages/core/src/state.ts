/**
 * The state machine of the office (step 1). Pure functions only: no clock, no I/O.
 *
 * Every agent session has its own state. Time moves only through events, including the
 * `tick` event the server sends on a timer, so the same events always give the same state.
 */

export type AgentKind = "codex" | "claude";

/** What the collectors send. `detail` is a short label (a tool name), never prompt text. */
export type AgentEventType =
  | "start"
  | "tool_start"
  | "tool_end"
  | "waiting"
  | "error"
  | "success"
  | "stop"
  | "fs_burst";

export interface AgentEvent {
  agent: AgentKind;
  /** The agent's session id; collectors derive one from agent and cwd when there is none. */
  sessionId: string;
  /** Working directory, used to map the session to a worktree. */
  cwd: string;
  type: AgentEventType;
  /** Milliseconds since the epoch. */
  ts: number;
  detail?: string;
}

/** The server's timer. It carries only the time. */
export interface TickEvent {
  type: "tick";
  ts: number;
}

export type SessionStatus = "idle" | "working" | "waiting" | "alert" | "success";

export interface Session {
  agent: AgentKind;
  sessionId: string;
  cwd: string;
  status: SessionStatus;
  /** When the current status began. */
  since: number;
  /** When the last agent event for this session arrived. */
  lastEventAt: number;
  detail?: string;
}

export interface OfficeState {
  sessions: Readonly<Record<string, Session>>;
  /** Time of the latest event seen (agent or tick). */
  now: number;
}

export interface Timing {
  /** How long `success` and `alert` stay before going back to `idle`. */
  holdMs: number;
  /** A `working` session with no event for this long is `idle`. */
  idleAfterMs: number;
  /** An `idle` session with no event for this long is removed. */
  forgetAfterMs: number;
}

export const DEFAULT_TIMING: Timing = {
  holdMs: 4_000,
  idleAfterMs: 30_000,
  forgetAfterMs: 30 * 60_000,
};

export const EMPTY_STATE: OfficeState = { sessions: {}, now: 0 };

/** Sessions of different agents never share a key, even with the same id. */
export function sessionKey(agent: AgentKind, sessionId: string): string {
  return `${agent}:${sessionId}`;
}

const STATUS_FOR: Record<AgentEventType, SessionStatus> = {
  start: "working",
  tool_start: "working",
  tool_end: "working",
  fs_burst: "working",
  waiting: "waiting",
  error: "alert",
  success: "success",
  stop: "success",
};

export function reduce(
  state: OfficeState,
  event: AgentEvent | TickEvent,
  timing: Timing = DEFAULT_TIMING,
): OfficeState {
  const now = Math.max(state.now, event.ts);
  if (event.type === "tick") {
    return expire(state.sessions, now, timing);
  }
  const key = sessionKey(event.agent, event.sessionId);
  const before = state.sessions[key];
  const status = STATUS_FOR[event.type];
  const session: Session = {
    agent: event.agent,
    sessionId: event.sessionId,
    cwd: event.cwd,
    status,
    since: before && before.status === status ? before.since : event.ts,
    lastEventAt: event.ts,
  };
  if (event.detail !== undefined) {
    session.detail = event.detail;
  }
  return expire({ ...state.sessions, [key]: session }, now, timing);
}

function expire(
  sessions: Readonly<Record<string, Session>>,
  now: number,
  timing: Timing,
): OfficeState {
  const next: Record<string, Session> = {};
  for (const [key, session] of Object.entries(sessions)) {
    const quiet = now - session.lastEventAt;
    if (session.status === "idle" && quiet >= timing.forgetAfterMs) {
      continue;
    }
    const held = session.status === "success" || session.status === "alert";
    if (held && now - session.since >= timing.holdMs) {
      next[key] = toIdle(session, session.since + timing.holdMs);
    } else if (session.status === "working" && quiet >= timing.idleAfterMs) {
      next[key] = toIdle(session, session.lastEventAt + timing.idleAfterMs);
    } else {
      next[key] = session;
    }
  }
  return { sessions: next, now };
}

function toIdle(session: Session, since: number): Session {
  const { detail: _detail, ...rest } = session;
  return { ...rest, status: "idle", since };
}

/** The office-wide scene the UI draws, from the prompt's five states. */
export type SceneMode = "IDLE" | "CODEX_BUILDING" | "CLAUDE_RUNNING" | "CLAUDE_ALERT" | "SUCCESS";

export interface Scene {
  mode: SceneMode;
  /** The agent the scene is about, or null when the office is idle. */
  focus: AgentKind | null;
  /** Per agent kind: the most urgent status among its sessions. */
  desks: Record<AgentKind, SessionStatus>;
}

const URGENCY: SessionStatus[] = ["alert", "waiting", "working", "success", "idle"];

/**
 * Picks the scene. An alert or a wait for the user beats everything, because a person has
 * to act. Then the agent that started working most recently is the main character. A
 * success shows only when nobody is working.
 */
export function scene(state: OfficeState): Scene {
  const sessions = Object.values(state.sessions);
  const desks: Record<AgentKind, SessionStatus> = {
    codex: mostUrgent(sessions.filter((s) => s.agent === "codex")),
    claude: mostUrgent(sessions.filter((s) => s.agent === "claude")),
  };
  const latest = (statuses: SessionStatus[]) =>
    sessions
      .filter((s) => statuses.includes(s.status))
      .sort((a, b) => b.since - a.since || a.sessionId.localeCompare(b.sessionId))[0];

  const needsUser = latest(["alert", "waiting"]);
  if (needsUser) {
    return { mode: "CLAUDE_ALERT", focus: needsUser.agent, desks };
  }
  const working = latest(["working"]);
  if (working) {
    const mode = working.agent === "codex" ? "CODEX_BUILDING" : "CLAUDE_RUNNING";
    return { mode, focus: working.agent, desks };
  }
  const done = latest(["success"]);
  if (done) {
    return { mode: "SUCCESS", focus: done.agent, desks };
  }
  return { mode: "IDLE", focus: null, desks };
}

function mostUrgent(sessions: Session[]): SessionStatus {
  for (const status of URGENCY) {
    if (sessions.some((s) => s.status === status)) {
      return status;
    }
  }
  return "idle";
}
