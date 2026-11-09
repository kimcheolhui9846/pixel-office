import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type AgentEvent,
  DEFAULT_TIMING,
  EMPTY_STATE,
  fromClaudeHook,
  fromCodexHook,
  isDocPath,
  MAX_PEOPLE,
  type OfficeState,
  reduce,
  scene,
  zoneForRole,
  zoneOfTool,
} from "../src/index.js";
import { checkEvent } from "../src/node/validate.js";

describe("zoneOfTool", () => {
  test("plan: to-do lists, plan mode, questions, handing work to a subagent", () => {
    for (const tool of ["TodoWrite", "ExitPlanMode", "AskUserQuestion", "Task", "Agent", "update_plan"]) {
      assert.equal(zoneOfTool(tool, {}), "plan", tool);
    }
  });

  test("design for documents, build for everything else", () => {
    assert.equal(zoneOfTool("Write", { file_path: "D:\\repo\\README.md" }), "design");
    assert.equal(zoneOfTool("Edit", { file_path: "/repo/docs/api/index.ts" }), "design");
    assert.equal(zoneOfTool("Edit", { file_path: "/repo/src/app.ts" }), "build");
    assert.equal(zoneOfTool("NotebookEdit", { notebook_path: "/repo/a.ipynb" }), "build");
    assert.equal(zoneOfTool("Write", {}), "build");
  });

  test("apply_patch looks at the patched files", () => {
    const docs = "*** Begin Patch\n*** Update File: docs/DESIGN.md\n@@\n-a\n+b\n*** Add File: notes.txt\n+x\n*** End Patch";
    const code = "*** Begin Patch\n*** Update File: docs/DESIGN.md\n*** Update File: src/a.ts\n*** End Patch";
    assert.equal(zoneOfTool("apply_patch", { command: docs }), "design");
    assert.equal(zoneOfTool("apply_patch", { input: code }), "build");
    assert.equal(zoneOfTool("apply_patch", docs), "design");
  });

  test("shell: read-only commands are review, the rest is run", () => {
    assert.equal(zoneOfTool("Bash", { command: "npm test" }), "run");
    assert.equal(zoneOfTool("Bash", { command: "git diff HEAD~1" }), "review");
    assert.equal(zoneOfTool("PowerShell", { command: "Get-Content a.txt" }), "review");
    assert.equal(zoneOfTool("Bash", { command: "cat a && rm -rf b" }), "run");
    assert.equal(zoneOfTool("shell", { command: ["rg", "TODO"] }), "review");
    assert.equal(zoneOfTool("Bash", {}), "run");
  });

  test("reading and looking things up is review; unknown tools stay put", () => {
    for (const tool of ["Read", "Grep", "Glob", "WebFetch", "WebSearch", "web_search"]) {
      assert.equal(zoneOfTool(tool, {}), "review", tool);
    }
    assert.equal(zoneOfTool("mcp__playwright__browser_click", {}), undefined);
    assert.equal(zoneOfTool(undefined, {}), undefined);
  });

  test("isDocPath and zoneForRole", () => {
    assert.ok(isDocPath("C:\\x\\design\\flow.ts"));
    assert.ok(!isDocPath("src/documentation.ts"));
    assert.equal(zoneForRole("Explore"), "review");
    assert.equal(zoneForRole("code-reviewer"), "review");
    assert.equal(zoneForRole("Plan"), "plan");
    assert.equal(zoneForRole("architect"), "design");
    assert.equal(zoneForRole("test-runner"), "run");
    assert.equal(zoneForRole("general-purpose"), "build");
    assert.equal(zoneForRole(undefined), "build");
  });
});

describe("hooks carry the zone and the subagent, never the path or command", () => {
  const common = { session_id: "s1", cwd: "/repo", transcript_path: "/t.jsonl" };

  test("Claude: a subagent's tool call", () => {
    const event = fromClaudeHook(
      { ...common, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/repo/secret.env" }, agent_id: "ag-7", agent_type: "Explore" },
      5,
    );
    assert.deepEqual(event, { agent: "claude", type: "tool_start", sessionId: "s1", cwd: "/repo", ts: 5, detail: "Read", subagentId: "ag-7", role: "Explore", zone: "review" });
    assert.ok(!JSON.stringify(event).includes("secret"));
  });

  test("Claude: SubagentStart and SubagentStop", () => {
    const start = fromClaudeHook({ ...common, hook_event_name: "SubagentStart", agent_id: "ag-7", agent_type: "Plan" }, 1);
    assert.equal(start?.type, "start");
    assert.equal(start?.subagentId, "ag-7");
    const stop = fromClaudeHook({ ...common, hook_event_name: "SubagentStop", agent_id: "ag-7", agent_type: "Plan", last_assistant_message: "x" }, 2);
    assert.equal(stop?.type, "stop");
    assert.ok(!JSON.stringify(stop).includes("last_assistant"));
  });

  test("Claude: plan mode puts any tool in plan; --agent without agent_id is not a subagent", () => {
    const e = fromClaudeHook({ ...common, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {}, permission_mode: "plan", agent_type: "reviewer" });
    assert.equal(e?.zone, "plan");
    assert.equal(e?.subagentId, undefined);
  });

  test("Codex: apply_patch on source is build", () => {
    const e = fromCodexHook({ ...common, hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { command: "*** Update File: src/a.rs\n" } });
    assert.equal(e?.zone, "build");
    assert.ok(!JSON.stringify(e).includes("a.rs"));
  });
});

describe("subagents in the state and the scene", () => {
  const ev = (over: Partial<AgentEvent>): AgentEvent => ({ agent: "claude", sessionId: "s1", cwd: "/repo", type: "tool_start", ts: 0, ...over });
  const run = (events: AgentEvent[]): OfficeState => events.reduce((s, e) => reduce(s, e), EMPTY_STATE);

  test("a subagent is its own person and leaves after it finishes", () => {
    let state = run([
      ev({ ts: 0, zone: "build" }),
      ev({ ts: 1_000, type: "start", subagentId: "a", role: "Explore" }),
    ]);
    let people = scene(state).people;
    assert.deepEqual(people.map((p) => [p.id, p.kind, p.zone]), [
      ["claude:s1", "main", "build"],
      ["claude:s1/a", "sub", "review"],
    ]);
    assert.equal(people[1]?.role, "Explore");
    state = reduce(state, ev({ ts: 2_000, type: "stop", subagentId: "a" }));
    assert.equal(scene(state).people[1]?.status, "success");
    state = reduce(state, { type: "tick", ts: 2_000 + DEFAULT_TIMING.holdMs });
    assert.deepEqual(scene(state).people.map((p) => p.id), ["claude:s1"]);
  });

  test("a quiet subagent leaves; its work keeps the parent working", () => {
    let state = run([ev({ ts: 0 }), ev({ ts: 25_000, subagentId: "a" })]);
    state = reduce(state, { type: "tick", ts: 40_000 });
    assert.equal(state.sessions["claude:s1"]?.status, "working", "parent refreshed at 25 s");
    state = reduce(state, { type: "tick", ts: 25_000 + DEFAULT_TIMING.idleAfterMs });
    assert.equal(state.sessions["claude:s1/a"], undefined);
  });

  test("the zone follows the latest event that names one", () => {
    let state = run([ev({ ts: 0, type: "start", zone: "plan" }), ev({ ts: 1, zone: "build" })]);
    assert.equal(scene(state).people[0]?.zone, "build");
    state = reduce(state, ev({ ts: 2, type: "waiting" }));
    assert.equal(scene(state).people[0]?.zone, "build");
  });

  test("main sessions first, then subagents; at most MAX_PEOPLE, the rest counted", () => {
    const events: AgentEvent[] = [];
    for (let i = 0; i < 10; i += 1) {
      events.push(ev({ ts: i, subagentId: `sub${i}` }));
    }
    events.push(ev({ ts: 20, agent: "codex", sessionId: "c1" }), ev({ ts: 21, sessionId: "s2" }), ev({ ts: 22 }));
    const s = scene(run(events));
    assert.equal(s.people.length, MAX_PEOPLE);
    assert.equal(s.hidden, 13 - MAX_PEOPLE);
    assert.deepEqual(s.people.slice(0, 3).map((p) => p.kind), ["main", "main", "main"]);
    assert.deepEqual(s.people.slice(0, 3).map((p) => p.id), ["codex:c1", "claude:s2", "claude:s1"]);
  });
});

describe("the server accepts the new fields and nothing odd", () => {
  const body = { agent: "claude", type: "tool_start", sessionId: "s", cwd: "/r", ts: 1 };
  test("zone, subagentId and role are checked and copied", () => {
    const ok = checkEvent({ ...body, zone: "review", subagentId: "a1", role: "Explore", extra: "dropped" }, 9);
    assert.deepEqual(ok, { ok: true, event: { agent: "claude", type: "tool_start", sessionId: "s", cwd: "/r", ts: 9, zone: "review", subagentId: "a1", role: "Explore" } });
    assert.equal(checkEvent({ ...body, zone: "lounge" }, 1).ok, false);
    assert.equal(checkEvent({ ...body, subagentId: "" }, 1).ok, false);
    assert.equal(checkEvent({ ...body, subagentId: "a\nb" }, 1).ok, false);
    assert.equal(checkEvent({ ...body, subagentId: "a", role: "x".repeat(41) }, 1).ok, false);
  });
});
