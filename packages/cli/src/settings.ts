/**
 * Adding and removing the Pixel Office hooks in Claude Code's user settings
 * (`~/.claude/settings.json`) and Codex's user hooks (`~/.codex/hooks.json`). Both files use
 * the same shape: `hooks.<Event>[]` matcher groups, each with a `hooks[]` list of handlers.
 * Pure: text in, text out, so `init` and `uninit` can show a diff before anything is written.
 *
 * Our hook handlers are recognised by what they run: `.../cli/dist/src/hook.js` followed by
 * the agent name, either as exec-form arguments (Claude) or inside a shell command string
 * (Codex, or a Claude hook someone rewrote by hand). Every other hook is left alone.
 */
import { CLAUDE_HOOK_EVENTS, CODEX_HOOK_EVENTS } from "@pixel-office/core";

/** Seconds. The agents do not enforce it on async hooks; it applies if async is ignored. */
export const HOOK_TIMEOUT_S = 3;

export type HookAgent = "claude" | "codex";

const EVENTS: Record<HookAgent, readonly string[]> = {
  claude: CLAUDE_HOOK_EVENTS,
  codex: CODEX_HOOK_EVENTS,
};

export interface HookTarget {
  /** Absolute path of the node binary (`process.execPath` of the node running init). */
  nodePath: string;
  /** Absolute path of `hook.js`. */
  hookPath: string;
  /** WSL only: the Windows `.pixel-office` folder as a `/mnt/<drive>/...` path. */
  pixelOfficeHome?: string;
  /** Windows host: Codex runs hook commands with `cmd.exe /C`, elsewhere with `$SHELL -lc`. */
  windows?: boolean;
}

export interface CommandHook {
  type: "command";
  command: string;
  args?: string[];
  async: true;
  timeout: number;
}

export class SettingsError extends Error {}

/**
 * Exec form (`command` plus `args`): Claude Code spawns the program directly with no shell,
 * so paths with spaces, quotes or `$` need no quoting on any OS, and it does not matter
 * whether Windows runs shell-form hooks in Git Bash or PowerShell. In WSL the variable is set
 * with `/usr/bin/env`, because there is no shell to read `VAR=value`.
 */
export function ourHook(target: HookTarget, agent: HookAgent = "claude"): CommandHook {
  if (agent === "codex") {
    return { type: "command", command: codexCommand(target), async: true, timeout: HOOK_TIMEOUT_S };
  }
  const run = [target.hookPath, "claude"];
  return target.pixelOfficeHome === undefined
    ? { type: "command", command: target.nodePath, args: run, async: true, timeout: HOOK_TIMEOUT_S }
    : {
        type: "command",
        command: "/usr/bin/env",
        args: [`PIXEL_OFFICE_HOME=${target.pixelOfficeHome}`, target.nodePath, ...run],
        async: true,
        timeout: HOOK_TIMEOUT_S,
      };
}

/**
 * Codex has no exec form: `command` is one string run by a shell. On Windows Codex runs
 * `cmd.exe /C "<command>"`; cmd drops the outer pair of quotes and runs
 * `"<node>" "<hook.js>" codex`. Double quotes keep spaces, but cmd still expands `%VAR%`
 * inside them, and a `"` cannot be quoted, so such paths are refused. Elsewhere the command
 * runs in `$SHELL -lc`; single quotes are literal in sh, bash, zsh and fish, and
 * `/usr/bin/env` sets the variable without relying on the shell's `VAR=value` syntax.
 */
export function codexCommand(target: HookTarget): string {
  if (target.windows === true) {
    for (const path of [target.nodePath, target.hookPath]) {
      if (/["%\r\n]/.test(path)) {
        throw new SettingsError(`Codex 훅 명령에 쓸 수 없는 문자(", %, 줄바꿈)가 경로에 있습니다: ${path}`);
      }
    }
    return `"${target.nodePath}" "${target.hookPath}" codex`;
  }
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  const run = `${quote(target.nodePath)} ${quote(target.hookPath)} codex`;
  return target.pixelOfficeHome === undefined
    ? run
    : `/usr/bin/env ${quote(`PIXEL_OFFICE_HOME=${target.pixelOfficeHome}`)} ${run}`;
}

const HOOK_SUFFIX = "/cli/dist/src/hook.js";

function isHookPath(value: unknown): boolean {
  return typeof value === "string" && value.replace(/\\/g, "/").endsWith(HOOK_SUFFIX);
}

/** True for a hook handler that Pixel Office wrote for this agent. */
export function isOurHook(handler: unknown, agent: HookAgent = "claude"): boolean {
  if (typeof handler !== "object" || handler === null) {
    return false;
  }
  const h = handler as Record<string, unknown>;
  if (h.type !== "command") {
    return false;
  }
  if (Array.isArray(h.args)) {
    const args: unknown[] = h.args;
    return args.some((arg, index) => isHookPath(arg) && args[index + 1] === agent);
  }
  return typeof h.command === "string" && COMMAND_PATTERN[agent].test(h.command);
}

const COMMAND_PATTERN: Record<HookAgent, RegExp> = {
  claude: /cli[\\/]+dist[\\/]+src[\\/]+hook\.js["']?\s+["']?claude(["'\s]|$)/,
  codex: /cli[\\/]+dist[\\/]+src[\\/]+hook\.js["']?\s+["']?codex(["'\s]|$)/,
};

interface Format {
  bom: boolean;
  eol: "\n" | "\r\n";
  indent: string;
  finalNewline: boolean;
}

type Json = Record<string, unknown>;

/** Parses settings text (null = no file). Throws SettingsError when it is not usable. */
function parse(text: string | null): { data: Json; format: Format } {
  const format: Format = { bom: false, eol: "\n", indent: "  ", finalNewline: true };
  if (text === null) {
    return { data: {}, format };
  }
  let body = text;
  if (body.startsWith("﻿")) {
    format.bom = true;
    body = body.slice(1);
  }
  if (body.trim() === "") {
    return { data: {}, format };
  }
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (error) {
    throw new SettingsError(`JSON 형식이 아닙니다 (${(error as Error).message})`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new SettingsError("맨 바깥이 JSON 객체가 아닙니다");
  }
  format.eol = body.includes("\r\n") ? "\r\n" : "\n";
  format.finalNewline = /\n$/.test(body);
  const indent = /^[{[][ \t]*\r?\n([ \t]+)\S/.exec(body);
  if (indent?.[1]) {
    format.indent = indent[1];
  }
  const hooks = (data as Json).hooks;
  if (hooks !== undefined) {
    if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
      throw new SettingsError("hooks 값이 객체가 아닙니다");
    }
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) {
        throw new SettingsError(`hooks.${event} 값이 배열이 아닙니다`);
      }
    }
  }
  return { data: data as Json, format };
}

function serialize(data: Json, format: Format): string {
  let text = JSON.stringify(data, null, format.indent);
  if (format.eol === "\r\n") {
    text = text.replace(/\n/g, "\r\n");
  }
  return (format.bom ? "﻿" : "") + text + (format.finalNewline ? format.eol : "");
}

/** A matcher group with our handlers taken out; null when nothing else was in it. */
function withoutOurs(group: unknown, agent: HookAgent): { group: unknown; removed: number } {
  if (typeof group !== "object" || group === null || !Array.isArray((group as Json).hooks)) {
    return { group, removed: 0 };
  }
  const handlers = (group as Json).hooks as unknown[];
  const kept = handlers.filter((h) => !isOurHook(h, agent));
  const removed = handlers.length - kept.length;
  if (removed === 0) {
    return { group, removed };
  }
  return { group: kept.length === 0 ? null : { ...(group as Json), hooks: kept }, removed };
}

function isOurGroup(group: unknown, wanted: Json): boolean {
  return JSON.stringify(group) === JSON.stringify(wanted);
}

export interface Change {
  before: string | null;
  after: string;
  changed: boolean;
}

/**
 * Puts our hook in every mapped event. An event that already has exactly our group is left
 * as it is (so init twice changes nothing); stale entries of ours (the repo moved, node
 * changed) are replaced where the first one was and the rest removed.
 */
export function addOurHooks(text: string | null, target: HookTarget, agent: HookAgent = "claude"): Change {
  const { data, format } = parse(text);
  const wanted: Json = { hooks: [ourHook(target, agent)] };
  const hooks: Json = (data.hooks as Json | undefined) ?? {};
  for (const event of EVENTS[agent]) {
    const groups = (hooks[event] as unknown[] | undefined) ?? [];
    const next: unknown[] = [];
    let placed = false;
    for (const group of groups) {
      if (isOurGroup(group, wanted) && !placed) {
        next.push(group);
        placed = true;
        continue;
      }
      const stripped = withoutOurs(group, agent);
      if (stripped.removed > 0 && !placed) {
        next.push(wanted);
        placed = true;
      }
      if (stripped.group !== null) {
        next.push(stripped.group);
      }
    }
    if (!placed) {
      next.push(wanted);
    }
    hooks[event] = next;
  }
  data.hooks = hooks;
  const after = serialize(data, format);
  return { before: text, after, changed: after !== text };
}

/**
 * Removes our handlers. A matcher group, an event array or the `hooks` object is removed
 * only when it became empty because of us; ones that were already empty stay.
 */
export function removeOurHooks(text: string | null, agent: HookAgent = "claude"): Change & { removed: number } {
  if (text === null) {
    return { before: null, after: "", changed: false, removed: 0 };
  }
  const { data, format } = parse(text);
  const hooks = data.hooks as Json | undefined;
  let removed = 0;
  if (hooks !== undefined) {
    for (const [event, value] of Object.entries(hooks)) {
      const groups = value as unknown[];
      const next: unknown[] = [];
      let removedHere = 0;
      for (const group of groups) {
        const stripped = withoutOurs(group, agent);
        removedHere += stripped.removed;
        if (stripped.group !== null) {
          next.push(stripped.group);
        }
      }
      if (removedHere === 0) {
        continue;
      }
      removed += removedHere;
      if (next.length === 0) {
        delete hooks[event];
      } else {
        hooks[event] = next;
      }
    }
    if (removed > 0 && Object.keys(hooks).length === 0) {
      delete data.hooks;
    }
  }
  if (removed === 0) {
    return { before: text, after: text, changed: false, removed };
  }
  const after = serialize(data, format);
  return { before: text, after, changed: after !== text, removed };
}
