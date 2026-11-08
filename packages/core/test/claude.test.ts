import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { exitCodeOf, fromClaudeHook, isTestCommand, LIMITS, WAITING_NOTIFICATIONS } from "../src/index.js";
import { checkEvent } from "../src/node/validate.js";

const NOW = 1_700_000_000_000;

// Common fields as in the examples of https://code.claude.com/docs/en/hooks
const common = {
  session_id: "abc123",
  transcript_path: "/Users/me/.claude/projects/p/00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  cwd: "/Users/me/my-project",
  permission_mode: "default",
};

const map = (payload: Record<string, unknown>) => fromClaudeHook({ ...common, ...payload }, NOW);

describe("fromClaudeHook: the mapping table", () => {
  test("UserPromptSubmit -> start, without the prompt", () => {
    const event = map({
      hook_event_name: "UserPromptSubmit",
      prompt: "Write a function to calculate the factorial of a number",
    });
    assert.deepEqual(event, { agent: "claude", type: "start", sessionId: "abc123", cwd: "/Users/me/my-project", ts: NOW });
  });

  test("PreToolUse -> tool_start with the tool name, command text not copied", () => {
    const event = map({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test", description: "Run test suite", timeout: 120000, run_in_background: false },
      tool_use_id: "toolu_01ABC123",
    });
    assert.deepEqual(event, {
      agent: "claude",
      type: "tool_start",
      sessionId: "abc123",
      cwd: "/Users/me/my-project",
      ts: NOW,
      detail: "Bash",
    });
    assert.doesNotMatch(JSON.stringify(event), /npm test|Run test suite/);
  });

  test("a long MCP tool name is cut to the server's detail limit", () => {
    const name = "mcp__some_server_with_a_long_name__and_a_long_tool_name";
    const event = map({ hook_event_name: "PreToolUse", tool_name: name, tool_input: {} });
    assert.equal(event?.detail, name.slice(0, LIMITS.detail));
    assert.equal(event?.detail?.length, 40);
  });

  test("PostToolUse -> tool_end (docs' Write example)", () => {
    const event = map({
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/path/to/file.txt", content: "file content" },
      tool_response: { filePath: "/path/to/file.txt", type: "create" },
      tool_use_id: "toolu_01ABC123",
      duration_ms: 12,
    });
    assert.equal(event?.type, "tool_end");
    assert.equal(event?.detail, "Write");
    assert.doesNotMatch(JSON.stringify(event), /file content|file\.txt/);
  });

  test("PostToolUse of a Bash test command -> success 'test'", () => {
    const event = map({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "cd packages/core && npm test", description: "Run test suite" },
      tool_response: { stdout: "ok", stderr: "", interrupted: false },
    });
    assert.equal(event?.type, "success");
    assert.equal(event?.detail, "test");
    assert.doesNotMatch(JSON.stringify(event), /packages|npm/);
  });

  test("PostToolUse of a PowerShell test command -> success 'test'", () => {
    const event = map({ hook_event_name: "PostToolUse", tool_name: "PowerShell", tool_input: { command: "npm test; exit $LASTEXITCODE" } });
    assert.equal(event?.type, "success");
  });

  test("PostToolUse of a non-test Bash command -> tool_end", () => {
    const event = map({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls -la" } });
    assert.equal(event?.type, "tool_end");
    assert.equal(event?.detail, "Bash");
  });

  test("a test-looking command in a non-shell tool is not a test run", () => {
    const event = map({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { command: "npm test" } });
    assert.equal(event?.type, "tool_end");
  });

  test("PostToolUseFailure of Bash -> error 'exit N' (docs' example)", () => {
    const event = map({
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "npm test", description: "Run test suite" },
      tool_use_id: "toolu_01ABC123",
      error: "Exit code 1\nError: Cannot find module 'express'",
      is_interrupt: false,
      duration_ms: 4187,
    });
    assert.equal(event?.type, "error");
    assert.equal(event?.detail, "exit 1");
    assert.doesNotMatch(JSON.stringify(event), /express/);
  });

  test("PostToolUseFailure of Bash without an exit-code line -> error with the tool name", () => {
    const event = map({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", error: "spawn /bin/bash ENOENT" });
    assert.equal(event?.type, "error");
    assert.equal(event?.detail, "Bash");
  });

  test("PostToolUseFailure of another tool -> error with the tool name", () => {
    const event = map({ hook_event_name: "PostToolUseFailure", tool_name: "Edit", error: "Exit code 3" });
    assert.equal(event?.detail, "Edit");
  });

  test("Notification types that need the user -> waiting", () => {
    for (const type of ["permission_prompt", "agent_needs_input", "elicitation_dialog", "elicitation_url_dialog"]) {
      const event = map({
        hook_event_name: "Notification",
        message: "Claude needs your permission",
        title: "Permission needed",
        notification_type: type,
      });
      assert.equal(event?.type, "waiting", type);
      assert.equal(event?.detail, undefined);
    }
    assert.equal(WAITING_NOTIFICATIONS.length, 4);
  });

  test("other Notification types -> null", () => {
    for (const type of [
      "idle_prompt",
      "auth_success",
      "auth_storage_failure",
      "elicitation_complete",
      "elicitation_response",
      "agent_completed",
      "quota_auto_resume_fired",
      "plugin_notification",
      "something_new",
    ]) {
      assert.equal(map({ hook_event_name: "Notification", message: "x", notification_type: type }), null, type);
    }
    assert.equal(map({ hook_event_name: "Notification", message: "x" }), null);
  });

  test("Stop -> stop", () => {
    const event = map({ hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Done. Secret plan." });
    assert.equal(event?.type, "stop");
    assert.doesNotMatch(JSON.stringify(event), /Secret/);
  });

  test("StopFailure -> error with the API error type (docs' example)", () => {
    const event = map({
      hook_event_name: "StopFailure",
      error: "rate_limit",
      error_details: "429 Too Many Requests",
      last_assistant_message: "API Error: Rate limit reached",
    });
    assert.equal(event?.type, "error");
    assert.equal(event?.detail, "rate_limit");
  });

  test("unknown and unmapped events -> null", () => {
    for (const name of ["SessionStart", "SessionEnd", "SubagentStop", "PreCompact", "Whatever", undefined]) {
      assert.equal(map({ hook_event_name: name, source: "startup", reason: "other" }), null, String(name));
    }
  });

  test("malformed payloads -> null", () => {
    assert.equal(fromClaudeHook(null), null);
    assert.equal(fromClaudeHook("Stop"), null);
    assert.equal(fromClaudeHook([common]), null);
    assert.equal(fromClaudeHook({ hook_event_name: "Stop", cwd: "/x" }), null);
    assert.equal(fromClaudeHook({ hook_event_name: "Stop", session_id: "s" }), null);
    assert.equal(fromClaudeHook({ hook_event_name: "Stop", session_id: "", cwd: "/x" }), null);
    assert.equal(fromClaudeHook({ hook_event_name: "Stop", session_id: "a\nb", cwd: "/x" }), null);
    assert.equal(fromClaudeHook({ hook_event_name: "Stop", session_id: "s".repeat(201), cwd: "/x" }), null);
    assert.equal(fromClaudeHook({ hook_event_name: "Stop", session_id: "s", cwd: "c".repeat(1025) }), null);
  });

  test("ts defaults to the current time", () => {
    const before = Date.now();
    const event = fromClaudeHook({ ...common, hook_event_name: "Stop" });
    assert.ok(event && event.ts >= before && event.ts <= Date.now());
  });

  test("every mapped event passes the server's own check", () => {
    const payloads = [
      { hook_event_name: "UserPromptSubmit", prompt: "hi" },
      { hook_event_name: "PreToolUse", tool_name: "mcp__\u0007x".repeat(20) },
      { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "pytest -q" } },
      { hook_event_name: "PostToolUseFailure", tool_name: "Bash", error: "Exit code 127" },
      { hook_event_name: "Notification", notification_type: "permission_prompt" },
      { hook_event_name: "Stop" },
      { hook_event_name: "StopFailure", error: "x".repeat(100) },
    ];
    for (const payload of payloads) {
      const event = map(payload);
      assert.ok(event, payload.hook_event_name);
      assert.equal(checkEvent(event, NOW).ok, true, JSON.stringify(event));
    }
  });

  test("a surrogate pair is not split when cutting", () => {
    const event = map({ hook_event_name: "PreToolUse", tool_name: `${"a".repeat(39)}\u{1F600}` });
    assert.equal(event?.detail, "a".repeat(39));
  });
});

describe("exitCodeOf", () => {
  test("reads the first line only", () => {
    assert.equal(exitCodeOf("Exit code 1\nError: x"), 1);
    assert.equal(exitCodeOf("Exit code 127"), 127);
    assert.equal(exitCodeOf("Exit code 2\r\nboom"), 2);
    assert.equal(exitCodeOf("Exit code -1\n"), -1);
    assert.equal(exitCodeOf("Error\nExit code 1"), undefined);
    assert.equal(exitCodeOf("Exit code one"), undefined);
    assert.equal(exitCodeOf(""), undefined);
    assert.equal(exitCodeOf(undefined), undefined);
    assert.equal(exitCodeOf(42), undefined);
  });
});

describe("isTestCommand (an estimate)", () => {
  const yes = [
    "pytest",
    "pytest -q tests/test_x.py",
    "py.test",
    "python -m pytest -x",
    "python3 -m pytest",
    "py -m pytest",
    "uv run pytest -q",
    "uv run python -m pytest",
    "poetry run pytest",
    "npm test",
    "npm t",
    "npm run test",
    "npm run test:unit",
    "npm test --workspaces",
    "pnpm test",
    "pnpm run test",
    "pnpm test:e2e",
    "yarn test",
    "yarn test:unit",
    "bun test",
    "npx vitest run",
    "vitest",
    "pnpm vitest run",
    "npx jest --ci",
    "jest",
    "go test ./...",
    "cargo test --all",
    "node --test",
    "node --test dist/test/a.test.js",
    "node --experimental-strip-types --test",
    "mvn test",
    "mvn -q clean test",
    "./mvnw test",
    "gradle test",
    "./gradlew :app:test",
    "gradlew.bat test",
    "cd packages/core && npm test",
    "npm run build && npm test",
    "CI=1 npm test",
    "env CI=1 FOO=bar pytest",
    "time cargo test",
    "npm test 2>&1 | tail -20",
    '"C:\\Program Files\\nodejs\\npm.cmd" test',
    "'/usr/local/bin/pytest' -q",
    "\"pytest\" -q",
  ];
  const no = [
    "",
    "ls -la",
    "npm install",
    "npm run build",
    "npm run lint",
    "git commit -m 'add pytest'",
    "echo npm test",
    "cat test.txt",
    "go build ./...",
    "cargo build",
    "node script.js",
    "node test.js",
    "mvn package",
    "gradle build",
    "python -m http.server",
    "grep -r jest .",
    "yarn install",
    "pnpm build",
  ];
  for (const command of yes) {
    test(`yes: ${command}`, () => assert.equal(isTestCommand(command), true));
  }
  for (const command of no) {
    test(`no: ${command || "(empty)"}`, () => assert.equal(isTestCommand(command), false));
  }
});
