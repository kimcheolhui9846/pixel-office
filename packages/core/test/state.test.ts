import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type AgentEvent,
  type AgentEventType,
  type AgentKind,
  DEFAULT_TIMING,
  EMPTY_STATE,
  type OfficeState,
  reduce,
  scene,
  sessionKey,
  type Timing,
} from "../src/state.js";

const T: Timing = { holdMs: 4_000, idleAfterMs: 30_000, forgetAfterMs: 600_000 };

function ev(
  type: AgentEventType,
  ts: number,
  agent: AgentKind = "claude",
  sessionId = "s1",
  detail?: string,
): AgentEvent {
  const e: AgentEvent = { agent, sessionId, cwd: "/w/" + sessionId, type, ts };
  if (detail !== undefined) e.detail = detail;
  return e;
}

function run(events: (AgentEvent | { type: "tick"; ts: number })[], timing = T): OfficeState {
  return events.reduce<OfficeState>((s, e) => reduce(s, e, timing), EMPTY_STATE);
}

function status(state: OfficeState, agent: AgentKind = "claude", id = "s1") {
  return state.sessions[sessionKey(agent, id)]?.status;
}

describe("transitions", () => {
  const cases: [AgentEventType, string][] = [
    ["start", "working"],
    ["tool_start", "working"],
    ["tool_end", "working"],
    ["fs_burst", "working"],
    ["waiting", "waiting"],
    ["error", "alert"],
    ["success", "success"],
    ["stop", "success"],
  ];
  for (const [type, want] of cases) {
    test(`${type} -> ${want}`, () => {
      assert.equal(status(run([ev(type, 1_000)])), want);
    });
  }

  test("since stays while the status does not change", () => {
    const s = run([ev("start", 1_000), ev("tool_start", 2_000), ev("tool_end", 3_000)]);
    const session = s.sessions[sessionKey("claude", "s1")]!;
    assert.equal(session.since, 1_000);
    assert.equal(session.lastEventAt, 3_000);
  });

  test("a new status restarts since", () => {
    const s = run([ev("start", 1_000), ev("error", 2_000)]);
    assert.equal(s.sessions[sessionKey("claude", "s1")]!.since, 2_000);
  });

  test("detail is kept only while the event has one", () => {
    let s = run([ev("tool_start", 1_000, "claude", "s1", "Bash")]);
    assert.equal(s.sessions[sessionKey("claude", "s1")]!.detail, "Bash");
    s = reduce(s, ev("tool_end", 2_000), T);
    assert.equal(s.sessions[sessionKey("claude", "s1")]!.detail, undefined);
  });

  test("the input state is not changed", () => {
    const before = run([ev("start", 1_000)]);
    const copy = structuredClone(before);
    reduce(before, ev("error", 2_000), T);
    reduce(before, { type: "tick", ts: 999_999 }, T);
    assert.deepEqual(before, copy);
  });
});

describe("automatic return to idle", () => {
  for (const type of ["success", "error"] as const) {
    test(`${type} holds for holdMs, then idle`, () => {
      const s0 = run([ev(type, 10_000)]);
      assert.notEqual(status(reduce(s0, { type: "tick", ts: 13_999 }, T)), "idle");
      const s1 = reduce(s0, { type: "tick", ts: 14_000 }, T);
      assert.equal(status(s1), "idle");
      assert.equal(s1.sessions[sessionKey("claude", "s1")]!.since, 14_000);
    });
  }

  test("working goes idle after idleAfterMs with no event", () => {
    const s0 = run([ev("start", 0), ev("tool_end", 5_000)]);
    assert.equal(status(reduce(s0, { type: "tick", ts: 34_999 }, T)), "working");
    assert.equal(status(reduce(s0, { type: "tick", ts: 35_000 }, T)), "idle");
  });

  test("waiting does not time out: the user still has to answer", () => {
    const s = run([ev("waiting", 0), { type: "tick", ts: 500_000 }]);
    assert.equal(status(s), "waiting");
  });

  test("an idle session is forgotten after forgetAfterMs", () => {
    const s0 = run([ev("stop", 0), { type: "tick", ts: 4_000 }]);
    assert.equal(status(s0), "idle");
    assert.equal(status(reduce(s0, { type: "tick", ts: 600_000 - 1 }, T)), "idle");
    assert.equal(status(reduce(s0, { type: "tick", ts: 600_000 }, T)), undefined);
  });

  test("timers are measured from event times, not from tick spacing", () => {
    const one = run([ev("success", 0), { type: "tick", ts: 100_000 }]);
    const many = run([ev("success", 0), ...[1, 2, 3, 4, 5].map((k) => ({ type: "tick" as const, ts: k * 20_000 }))]);
    assert.deepEqual(one, many);
  });

  test("time never runs backwards", () => {
    const s = run([ev("start", 10_000), ev("tool_end", 5_000)]);
    assert.equal(s.now, 10_000);
  });

  test("the default timing matches the documented values", () => {
    assert.deepEqual(DEFAULT_TIMING, { holdMs: 4_000, idleAfterMs: 30_000, forgetAfterMs: 1_800_000 });
  });
});

describe("several sessions", () => {
  test("sessions are kept apart", () => {
    const s = run([ev("start", 0, "claude", "a"), ev("error", 1_000, "claude", "b")]);
    assert.equal(status(s, "claude", "a"), "working");
    assert.equal(status(s, "claude", "b"), "alert");
  });

  test("the same id in two agents is two sessions", () => {
    const s = run([ev("start", 0, "claude", "x"), ev("stop", 1_000, "codex", "x")]);
    assert.equal(status(s, "claude", "x"), "working");
    assert.equal(status(s, "codex", "x"), "success");
  });

  test("a tick expires each session on its own clock", () => {
    const s = run([ev("success", 0, "claude", "a"), ev("success", 3_000, "codex", "b"), { type: "tick", ts: 5_000 }]);
    assert.equal(status(s, "claude", "a"), "idle");
    assert.equal(status(s, "codex", "b"), "success");
  });
});

describe("scene", () => {
  test("empty office is idle", () => {
    assert.deepEqual(scene(EMPTY_STATE), {
      mode: "IDLE",
      focus: null,
      desks: { codex: "idle", claude: "idle" },
      people: [],
      hidden: 0,
    });
  });

  test("codex working is CODEX_BUILDING", () => {
    assert.equal(scene(run([ev("fs_burst", 0, "codex")])).mode, "CODEX_BUILDING");
  });

  test("claude working is CLAUDE_RUNNING", () => {
    assert.equal(scene(run([ev("tool_start", 0, "claude")])).mode, "CLAUDE_RUNNING");
  });

  test("the agent that started working last is the main character", () => {
    const s = run([ev("start", 0, "claude", "a"), ev("start", 1_000, "codex", "b")]);
    assert.deepEqual([scene(s).mode, scene(s).focus], ["CODEX_BUILDING", "codex"]);
    const t = reduce(s, ev("start", 2_000, "claude", "c"), T);
    assert.deepEqual([scene(t).mode, scene(t).focus], ["CLAUDE_RUNNING", "claude"]);
  });

  test("an alert or a wait for the user beats working", () => {
    const alert = run([ev("start", 0, "codex", "a"), ev("error", 1_000, "claude", "b"), ev("start", 2_000, "codex", "c")]);
    assert.deepEqual([scene(alert).mode, scene(alert).focus], ["CLAUDE_ALERT", "claude"]);
    const wait = run([ev("start", 0, "codex", "a"), ev("waiting", 1_000, "claude", "b")]);
    assert.equal(scene(wait).mode, "CLAUDE_ALERT");
  });

  test("a codex alert also raises the alarm, with codex in focus", () => {
    const s = run([ev("error", 0, "codex")]);
    assert.deepEqual([scene(s).mode, scene(s).focus], ["CLAUDE_ALERT", "codex"]);
  });

  test("success shows only when nobody works", () => {
    const s = run([ev("stop", 0, "claude", "a"), ev("start", 1_000, "codex", "b")]);
    assert.equal(scene(s).mode, "CODEX_BUILDING");
    assert.equal(scene(run([ev("stop", 0, "claude")])).mode, "SUCCESS");
  });

  test("desks show the most urgent status of each agent", () => {
    const s = run([ev("stop", 0, "claude", "a"), ev("waiting", 1_000, "claude", "b"), ev("start", 2_000, "codex", "c")]);
    assert.deepEqual(scene(s).desks, { claude: "waiting", codex: "working" });
  });

  test("ties are broken the same way every time", () => {
    const a = run([ev("start", 0, "codex", "b"), ev("start", 0, "claude", "a")]);
    const b = run([ev("start", 0, "claude", "a"), ev("start", 0, "codex", "b")]);
    assert.deepEqual(scene(a), scene(b));
  });

  test("the five scene modes are all reachable", () => {
    const modes = new Set([
      scene(EMPTY_STATE).mode,
      scene(run([ev("start", 0, "codex")])).mode,
      scene(run([ev("start", 0, "claude")])).mode,
      scene(run([ev("error", 0, "claude")])).mode,
      scene(run([ev("stop", 0, "claude")])).mode,
    ]);
    assert.equal(modes.size, 5);
  });
});
