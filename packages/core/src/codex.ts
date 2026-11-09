/**
 * Codex hook payloads to office events (step 5). Pure and browser-safe, like claude.ts.
 *
 * Payload fields follow the Codex hooks reference (codex-cli 0.167.0, see DESIGN.md
 * section 8). Differences from Claude Code that shape this mapping:
 * - there is no PostToolUseFailure, and a shell tool's `tool_response` is only its output
 *   text (no exit code), so a failed command cannot be told from a successful one. Tool
 *   ends are always `tool_end`, and there is no "tests passed" estimate for Codex.
 * - a failed model request (`PostModelRequest` with `status: "failed"`) is the one error
 *   signal; its `error` text is not copied.
 * - `PermissionRequest` is the approval prompt, so it means "waiting for a person".
 * Only the event name, the tool name and fixed labels leave this function.
 */
import { shortLabel, text } from "./fields.js";
import { LIMITS } from "./limits.js";
import type { AgentEvent, AgentEventType } from "./state.js";
import { zoneOfTool } from "./zones.js";

/** The hook events `pixel-office init` registers for Codex; everything else maps to null. */
export const CODEX_HOOK_EVENTS = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "PostModelRequest",
  "Stop",
] as const;

export function fromCodexHook(payload: unknown, now: number = Date.now()): AgentEvent | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const p = payload as Record<string, unknown>;
  const sessionId = text(p.session_id, LIMITS.sessionId);
  const cwd = text(p.cwd, LIMITS.cwd);
  if (sessionId === undefined || cwd === undefined) {
    return null;
  }
  const toolName = typeof p.tool_name === "string" ? p.tool_name : undefined;

  let type: AgentEventType;
  let detail: string | undefined;
  switch (p.hook_event_name) {
    case "UserPromptSubmit":
      type = "start";
      break;
    case "PreToolUse":
      type = "tool_start";
      detail = toolName;
      break;
    case "PostToolUse":
      type = "tool_end";
      detail = toolName;
      break;
    case "PermissionRequest":
      type = "waiting";
      detail = toolName;
      break;
    case "PostModelRequest":
      // completed and cancelled requests are ordinary; only a failure is shown
      if (p.status !== "failed") {
        return null;
      }
      type = "error";
      detail = "model";
      break;
    case "Stop":
      type = "stop";
      break;
    default:
      return null;
  }

  const event: AgentEvent = { agent: "codex", type, sessionId, cwd, ts: now };
  const label = detail === undefined ? undefined : shortLabel(detail);
  if (label) {
    event.detail = label;
  }
  const zone =
    p.hook_event_name === "UserPromptSubmit"
      ? "plan"
      : p.hook_event_name === "PreToolUse" || p.hook_event_name === "PostToolUse" || p.hook_event_name === "PermissionRequest"
        ? zoneOfTool(toolName, p.tool_input)
        : undefined;
  if (zone !== undefined) {
    event.zone = zone;
  }
  return event;
}
