/**
 * Claude Code hook payloads to office events (step 4). Pure and browser-safe: no I/O, and
 * the only clock read is `ts`, which the server replaces with its own time anyway.
 *
 * Payload fields follow https://code.claude.com/docs/en/hooks (see DESIGN.md section 7).
 * Only short labels leave this function: the prompt, the shell command and tool output are
 * read here at most to pick a label and are never copied into the event.
 */
import { LIMITS } from "./limits.js";
import { shortLabel, text } from "./fields.js";
import type { AgentEvent, AgentEventType } from "./state.js";

/** The hook events `pixel-office init` registers; everything else maps to null. */
export const CLAUDE_HOOK_EVENTS = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "StopFailure",
] as const;

/**
 * Notification types that mean "a person has to act before Claude can go on". From the
 * docs' matcher table: a tool permission prompt, a background or teammate session waiting
 * for input, and MCP elicitation dialogs (a form or a URL to open). `idle_prompt` (Claude
 * finished a while ago) and the auth, quota and plugin notices do not block work.
 */
export const WAITING_NOTIFICATIONS: readonly string[] = [
  "permission_prompt",
  "agent_needs_input",
  "elicitation_dialog",
  "elicitation_url_dialog",
];

/** Tools that run shell commands; their failures start with `Exit code N`. */
const SHELL_TOOLS: readonly string[] = ["Bash", "PowerShell"];

export function fromClaudeHook(payload: unknown, now: number = Date.now()): AgentEvent | null {
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
      if (toolName !== undefined && SHELL_TOOLS.includes(toolName) && isTestCommand(commandOf(p.tool_input))) {
        // PostToolUse fires only when the tool succeeded, so a test command that got here
        // passed (an estimate: see isTestCommand).
        type = "success";
        detail = "test";
      } else {
        type = "tool_end";
        detail = toolName;
      }
      break;
    case "PostToolUseFailure": {
      type = "error";
      const exit = toolName !== undefined && SHELL_TOOLS.includes(toolName) ? exitCodeOf(p.error) : undefined;
      detail = exit !== undefined ? `exit ${exit}` : toolName;
      break;
    }
    case "Notification":
      if (typeof p.notification_type !== "string" || !WAITING_NOTIFICATIONS.includes(p.notification_type)) {
        return null;
      }
      type = "waiting";
      break;
    case "Stop":
      type = "stop";
      break;
    case "StopFailure":
      // `error` is an API error type such as rate_limit; it is a fixed label, not user text
      type = "error";
      detail = typeof p.error === "string" ? p.error : undefined;
      break;
    default:
      return null;
  }

  const event: AgentEvent = { agent: "claude", type, sessionId, cwd, ts: now };
  const label = detail === undefined ? undefined : shortLabel(detail);
  if (label) {
    event.detail = label;
  }
  return event;
}

/** `Exit code N` on the first line of a Bash or PowerShell failure, as the docs describe. */
export function exitCodeOf(error: unknown): number | undefined {
  if (typeof error !== "string") {
    return undefined;
  }
  const m = /^Exit code (-?\d{1,10})\s*$/.exec(error.split(/\r?\n/, 1)[0] ?? "");
  return m ? Number(m[1]) : undefined;
}

function commandOf(toolInput: unknown): string {
  if (typeof toolInput === "object" && toolInput !== null) {
    const command = (toolInput as Record<string, unknown>).command;
    if (typeof command === "string") {
      return command;
    }
  }
  return "";
}

/**
 * ESTIMATE: guesses from the command text whether a shell command ran a test suite. It
 * splits the command at `;`, `&&`, `||`, `|` and newlines, drops leading `VAR=value`
 * assignments and wrappers (`env`, `sudo`, `time`, `npx`, `bunx`, `pnpx`, `uv run`,
 * `poetry run`, `pdm run`, `pnpm exec`, `pnpm dlx`, `yarn exec`, `yarn dlx`, `npm exec`,
 * `python -m`, `python3 -m`, `py -m`) and looks for one of:
 *
 *   pytest, py.test
 *   npm t, npm/pnpm/yarn/bun test, npm/pnpm/yarn/bun run test[:name], yarn/pnpm test:name
 *   vitest, jest (also as `pnpm vitest`, `yarn jest` and so on)
 *   go test, cargo test
 *   node ... --test
 *   mvn/mvnw ... test, gradle/gradlew ... test or :module:test
 *
 * It is wrong for scripts that run tests under another name, and for a `test` npm script
 * that does something else. The text stays on this machine; only the label "test" is sent.
 */
export function isTestCommand(command: string): boolean {
  if (command.length === 0 || command.length > 64 * 1024) {
    return false;
  }
  return command
    .split(/&&|\|\||[;|\n]/)
    .some((segment) => matchesTestRunner(unwrap(tokens(segment))));
}

/** Words of one command; a quoted word (`"C:\Program Files\x.exe"`) stays one word. */
function tokens(segment: string): string[] {
  const words: string[] = [];
  for (const m of segment.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    words.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return words;
}

/** Lower-case program name without directory or Windows extension: `C:\x\npm.cmd` -> `npm`. */
function program(token: string | undefined): string {
  if (token === undefined) {
    return "";
  }
  const base = token.split(/[\\/]/).pop() ?? "";
  return base.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
}

const PREFIXES = new Set(["env", "sudo", "time", "npx", "bunx", "pnpx", "command", "exec"]);
const TWO_WORD_PREFIXES = new Set([
  "uv run",
  "poetry run",
  "pdm run",
  "pnpm exec",
  "pnpm dlx",
  "yarn exec",
  "yarn dlx",
  "npm exec",
]);
const PYTHONS = new Set(["python", "python3", "py"]);

function unwrap(input: string[]): string[] {
  let t = input;
  for (let guard = 0; guard < 16 && t.length > 0; guard += 1) {
    const first = t[0] ?? "";
    const head = program(first);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
      t = t.slice(1);
    } else if (PREFIXES.has(head)) {
      t = t.slice(1);
      // wrapper options such as `npx --yes` or `env -i`
      while (t.length > 0 && (t[0] ?? "").startsWith("-")) {
        t = t.slice(1);
      }
    } else if (TWO_WORD_PREFIXES.has(`${head} ${t[1] ?? ""}`)) {
      t = t.slice(2);
      while (t.length > 0 && (t[0] ?? "").startsWith("-")) {
        t = t.slice(1);
      }
    } else if (PYTHONS.has(head) && t[1] === "-m" && t[2] !== undefined) {
      t = t.slice(2);
    } else {
      break;
    }
  }
  return t;
}

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const isTestScript = (name: string | undefined) => name === "test" || (name ?? "").startsWith("test:");

function matchesTestRunner(t: string[]): boolean {
  const head = program(t[0]);
  const args = t.slice(1);
  if (head === "pytest" || head === "py.test" || head === "vitest" || head === "jest") {
    return true;
  }
  if (PACKAGE_MANAGERS.has(head)) {
    const [a, b] = args;
    if (a === "test" || (head === "npm" && a === "t") || a === "vitest" || a === "jest") {
      return true;
    }
    if (a === "run" || a === "run-script") {
      return isTestScript(b);
    }
    // `yarn test:unit` and `pnpm test:unit` run the script directly
    return (head === "yarn" || head === "pnpm") && isTestScript(a);
  }
  if (head === "go" || head === "cargo") {
    return args[0] === "test";
  }
  if (head === "node") {
    return args.includes("--test");
  }
  if (head === "mvn" || head === "mvnw") {
    return args.includes("test");
  }
  if (head === "gradle" || head === "gradlew") {
    return args.some((a) => a === "test" || a.endsWith(":test"));
  }
  return false;
}
