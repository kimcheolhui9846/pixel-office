import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CODEX_HOOK_EVENTS, fromCodexHook, LIMITS } from "../src/index.js";
import { checkEvent } from "../src/node/validate.js";

const NOW = 1_700_000_000_000;

// Common fields from the Codex hooks reference (codex-cli 0.167.0)
const common = {
  session_id: "019a-codex-session",
  transcript_path: null,
  cwd: "D:\\work\\repo",
  model: "gpt-5.3-codex",
  turn_id: "turn-1",
  permission_mode: "default",
};

const map = (payload: Record<string, unknown>) => fromCodexHook({ ...common, ...payload }, NOW);
const base = { agent: "codex", sessionId: "019a-codex-session", cwd: "D:\\work\\repo", ts: NOW };

describe("fromCodexHook: the mapping table", () => {
  test("UserPromptSubmit -> start, without the prompt", () => {
    assert.deepEqual(map({ hook_event_name: "UserPromptSubmit", prompt: "delete the secrets" }), { ...base, type: "start", zone: "plan" });
  });

  test("PreToolUse -> tool_start with the tool name, command not copied", () => {
    const event = map({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "call-1",
      tool_input: { command: "cat ~/.ssh/id_ed25519" },
    });
    assert.deepEqual(event, { ...base, type: "tool_start", detail: "Bash", zone: "review" });
    assert.ok(!JSON.stringify(event).includes("ssh"));
  });

  test("PostToolUse -> tool_end, output not copied (Codex gives no exit code)", () => {
    const event = map({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_response: "1 failing\nExit code 1",
    });
    assert.deepEqual(event, { ...base, type: "tool_end", detail: "Bash", zone: "run" });
  });

  test("PermissionRequest -> waiting", () => {
    const event = map({ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { description: null } });
    assert.deepEqual(event, { ...base, type: "waiting", detail: "Bash", zone: "run" });
  });

  test("PostModelRequest: only failed -> error, error text not copied", () => {
    const failed = map({ hook_event_name: "PostModelRequest", status: "failed", error: "token sk-abc expired" });
    assert.deepEqual(failed, { ...base, type: "error", detail: "model" });
    assert.equal(map({ hook_event_name: "PostModelRequest", status: "completed" }), null);
    assert.equal(map({ hook_event_name: "PostModelRequest", status: "cancelled" }), null);
    assert.equal(map({ hook_event_name: "PostModelRequest" }), null);
  });

  test("Stop -> stop, last message not copied", () => {
    const event = map({ hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "the password is x" });
    assert.deepEqual(event, { ...base, type: "stop" });
  });

  test("events we do not register map to null", () => {
    for (const name of ["SessionStart", "SessionEnd", "Interrupt", "PreCompact", "SubagentStart", "Nope"]) {
      assert.equal(map({ hook_event_name: name }), null, name);
    }
  });

  test("every registered event can produce an event", () => {
    const extra: Record<string, Record<string, unknown>> = { PostModelRequest: { status: "failed" } };
    for (const name of CODEX_HOOK_EVENTS) {
      assert.notEqual(map({ hook_event_name: name, tool_name: "Bash", ...extra[name] }), null, name);
    }
  });
});

describe("fromCodexHook: bad input", () => {
  test("not an object", () => {
    for (const value of [null, undefined, 1, "x", [], [common]]) {
      assert.equal(fromCodexHook(value, NOW), null);
    }
  });

  test("missing or bad session_id or cwd", () => {
    assert.equal(map({ hook_event_name: "Stop", session_id: undefined }), null);
    assert.equal(map({ hook_event_name: "Stop", session_id: "" }), null);
    assert.equal(map({ hook_event_name: "Stop", session_id: "a".repeat(LIMITS.sessionId + 1) }), null);
    assert.equal(map({ hook_event_name: "Stop", cwd: 7 }), null);
    assert.equal(map({ hook_event_name: "Stop", cwd: "C:\\a\nb" }), null);
  });

  test("a long or odd tool name is cut to a valid label", () => {
    const event = map({ hook_event_name: "PreToolUse", tool_name: `mcp__${"x".repeat(80)}\u0007` });
    assert.equal(event?.detail?.length, LIMITS.detail);
    assert.equal(checkEvent(event, NOW).ok, true);
  });

  test("every mapped event passes the server's validation", () => {
    for (const name of CODEX_HOOK_EVENTS) {
      const event = map({ hook_event_name: name, tool_name: "apply_patch", status: "failed" });
      assert.equal(checkEvent(event, NOW).ok, true, name);
    }
  });
});
