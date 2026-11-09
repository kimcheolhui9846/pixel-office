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

/**
 * Work zones of the office floor (step 9c). The collectors pick one from the tool an agent
 * uses (an estimate, see `zones.ts`); the UI walks the person to that zone.
 *  plan    기획: instructions just arrived, to-do lists, plan mode, questions to the user
 *  design  설계: writing documents (.md and the like, docs/ folders)
 *  build   구현: editing or creating source files
 *  run     작업: running commands and tests
 *  review  검토: reading and searching files, web lookups, reviews
 */
export type Zone = "plan" | "design" | "build" | "run" | "review";
export const ZONES: readonly Zone[] = ["plan", "design", "build", "run", "review"];

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
  /** The zone the work belongs in, when the collector could tell. */
  zone?: Zone;
  /** Set when the event comes from a subagent of the session: its id from the agent. */
  subagentId?: string;
  /** The subagent's type (for example `Explore`), a short label. */
  role?: string;
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
  /** Where the person sits now; the last zone an event named. */
  zone: Zone;
  /** Subagents only: their id and type. The main session has neither. */
  subagentId?: string;
  role?: string;
  /** When this session was first seen (keeps the order of people stable). */
  firstSeen: number;
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
  const main = sessionKey(event.agent, event.sessionId);
  const key = event.subagentId === undefined ? main : `${main}/${event.subagentId}`;
  const before = state.sessions[key];
  const status = STATUS_FOR[event.type];
  const session: Session = {
    agent: event.agent,
    sessionId: event.sessionId,
    cwd: event.cwd,
    status,
    since: before && before.status === status ? before.since : event.ts,
    lastEventAt: event.ts,
    zone: event.zone ?? before?.zone ?? (event.subagentId === undefined ? "plan" : zoneForRole(event.role)),
    firstSeen: before?.firstSeen ?? event.ts,
  };
  if (event.detail !== undefined) {
    session.detail = event.detail;
  }
  if (event.subagentId !== undefined) {
    session.subagentId = event.subagentId;
    const role = event.role ?? before?.role;
    if (role !== undefined) {
      session.role = role;
    }
  }
  const sessions: Record<string, Session> = { ...state.sessions, [key]: session };
  // a subagent at work keeps its parent session from falling idle
  const parent = sessions[main];
  if (key !== main && parent !== undefined && parent.status === "working") {
    sessions[main] = { ...parent, lastEventAt: Math.max(parent.lastEventAt, event.ts) };
  }
  return expire(sessions, now, timing);
}

/** Where a new subagent starts, from its type: reviewers and explorers read, planners plan. */
export function zoneForRole(role: string | undefined): Zone {
  const r = (role ?? "").toLowerCase();
  if (/review|explore|search|research|audit|inspect/.test(r)) {
    return "review";
  }
  if (/plan|architect|design/.test(r)) {
    return /design|architect/.test(r) ? "design" : "plan";
  }
  if (/test|debug|run/.test(r)) {
    return "run";
  }
  return "build";
}

function expire(
  sessions: Readonly<Record<string, Session>>,
  now: number,
  timing: Timing,
): OfficeState {
  const next: Record<string, Session> = {};
  for (const [key, session] of Object.entries(sessions)) {
    const quiet = now - session.lastEventAt;
    const held = session.status === "success" || session.status === "alert";
    if (session.subagentId !== undefined) {
      // subagents leave the office when they finish (after the hold) or go quiet
      const done = session.status === "success" && now - session.since >= timing.holdMs;
      const gone = session.status !== "waiting" && quiet >= timing.idleAfterMs;
      if (done || gone || session.status === "idle") {
        continue;
      }
      next[key] = held && now - session.since >= timing.holdMs ? { ...session, status: "working", since: session.since + timing.holdMs } : session;
      continue;
    }
    if (session.status === "idle" && quiet >= timing.forgetAfterMs) {
      continue;
    }
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
  /**
   * Everyone in the office, main sessions first, then subagents, each group by first seen.
   * At most `MAX_PEOPLE`; `hidden` counts the rest.
   */
  people: Person[];
  hidden: number;
}

export interface Person {
  /** Stable id (the session key), used by the UI to follow a person as they walk. */
  id: string;
  agent: AgentKind;
  kind: "main" | "sub";
  /** Subagent type label, such as `Explore`. */
  role?: string;
  status: SessionStatus;
  zone: Zone;
}

export const MAX_PEOPLE = 12;

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

  const all = people(state);
  const base = { desks, people: all.slice(0, MAX_PEOPLE), hidden: Math.max(0, all.length - MAX_PEOPLE) };
  const needsUser = latest(["alert", "waiting"]);
  if (needsUser) {
    return { mode: "CLAUDE_ALERT", focus: needsUser.agent, ...base };
  }
  const working = latest(["working"]);
  if (working) {
    const mode = working.agent === "codex" ? "CODEX_BUILDING" : "CLAUDE_RUNNING";
    return { mode, focus: working.agent, ...base };
  }
  const done = latest(["success"]);
  if (done) {
    return { mode: "SUCCESS", focus: done.agent, ...base };
  }
  return { mode: "IDLE", focus: null, ...base };
}

/** Main sessions first, then subagents; each group in the order they first appeared. */
function people(state: OfficeState): Person[] {
  return Object.entries(state.sessions)
    .map(([id, s]) => ({ id, s }))
    .sort(
      (a, b) =>
        Number(a.s.subagentId !== undefined) - Number(b.s.subagentId !== undefined) ||
        a.s.firstSeen - b.s.firstSeen ||
        a.id.localeCompare(b.id),
    )
    .map(({ id, s }) => {
      const person: Person = { id, agent: s.agent, kind: s.subagentId === undefined ? "main" : "sub", status: s.status, zone: s.zone };
      if (s.role !== undefined) {
        person.role = s.role;
      }
      return person;
    });
}

function mostUrgent(sessions: Session[]): SessionStatus {
  for (const status of URGENCY) {
    if (sessions.some((s) => s.status === status)) {
      return status;
    }
  }
  return "idle";
}
