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

/** Seconds. Claude Code ignores it for async hooks; the Codex hook is synchronous, so it applies there. */
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
  /** Windows host: the Codex hook goes through a `.cmd` wrapper (see `codexCommand`). */
  windows?: boolean;
  /** Windows only: absolute path of the Codex wrapper, `<pixel-office home>\${CODEX_WRAPPER_NAME}`. */
  codexWrapper?: string;
}

/** File name of the Windows wrapper that runs the Codex hook. */
export const CODEX_WRAPPER_NAME = "pixel-office-codex-hook.cmd";

export interface CommandHook {
  type: "command";
  command: string;
  args?: string[];
  async?: true;
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
    // Synchronous: the only form seen working in a real Codex session so far (DESIGN.md 8.6).
    // The hook itself ends within 500 ms, so Codex waits at most that long per event.
    return { type: "command", command: codexCommand(target), timeout: HOOK_TIMEOUT_S };
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
 * Codex has no exec form: `command` is one string run by a shell, and on Windows that shell
 * is not fixed. The source falls back to `cmd.exe /C`, but codex-cli 0.167.0 ran our hooks in
 * PowerShell, where a line that starts with a quoted path is a string, not a command
 * (DESIGN.md 8.6). So on Windows the command is the bare path of a `.cmd` wrapper, written
 * with `/` and without spaces: cmd, PowerShell and Git Bash all run that the same way (Orca's
 * own Codex hook works like this). The wrapper path must therefore have no spaces or shell
 * characters; `init` refuses otherwise.
 *
 * Elsewhere the command runs in `$SHELL -lc`; single quotes are literal in sh, bash, zsh and
 * fish, and `/usr/bin/env` sets the variable without relying on the shell's `VAR=value`.
 */
export function codexCommand(target: HookTarget): string {
  if (target.windows === true) {
    const wrapper = target.codexWrapper;
    if (wrapper === undefined) {
      throw new SettingsError("Codex 훅 래퍼 경로가 없습니다");
    }
    const command = wrapper.replace(/\\/g, "/");
    // `~` appears in 8.3 short names such as C:/Users/RUNNER~1; it is literal mid-word
    if (!/^[A-Za-z]:\/[A-Za-z0-9._~\/-]+$/.test(command)) {
      throw new SettingsError(
        `Codex 훅 래퍼 경로에 공백이나 특수 문자가 있어 셸 없이 실행할 수 없습니다: ${wrapper}\n` +
          "PIXEL_OFFICE_HOME을 공백 없는 폴더(예: C:\\pixel-office)로 지정하고 다시 실행하세요.",
      );
    }
    return command;
  }
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  const run = `${quote(target.nodePath)} ${quote(target.hookPath)} codex`;
  return target.pixelOfficeHome === undefined
    ? run
    : `/usr/bin/env ${quote(`PIXEL_OFFICE_HOME=${target.pixelOfficeHome}`)} ${run}`;
}

/**
 * The Windows wrapper's text (CRLF). `@echo off` keeps cmd from echoing the command, which
 * Codex would add to the model's context on UserPromptSubmit; the wrapper always exits 0.
 * Inside a `.cmd` file `%` starts a variable, so paths with `%` or `"` are refused.
 */
export function codexWrapperScript(target: HookTarget): string {
  for (const path of [target.nodePath, target.hookPath]) {
    if (/["%\r\n]/.test(path)) {
      throw new SettingsError(`Codex 훅 래퍼에 쓸 수 없는 문자(", %, 줄바꿈)가 경로에 있습니다: ${path}`);
    }
  }
  return [
    "@echo off",
    "rem Pixel Office: runs the Codex hook. Written by `pixel-office init`, removed by `uninit`.",
    `"${target.nodePath}" "${target.hookPath}" codex`,
    "exit /b 0",
    "",
  ].join("\r\n");
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
  // the wrapper (Windows), or node plus hook.js (elsewhere, and older Windows entries)
  codex: /pixel-office-codex-hook\.cmd["']?\s*$|cli[\\/]+dist[\\/]+src[\\/]+hook\.js["']?\s+["']?codex(["'\s]|$)/,
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

export interface HookStatus {
  /** Events our hook should be in. */
  total: number;
  /** Events that hold exactly the group `init` would write now. */
  current: number;
  /** Events without any hook of ours. */
  missing: string[];
}

/**
 * How far the settings match what `init` would write, for `doctor`. Compares the parsed
 * groups, not the text, so a reformatted file still counts as current.
 * Throws SettingsError when the file is not usable.
 */
export function hookStatus(text: string | null, target: HookTarget, agent: HookAgent = "claude"): HookStatus {
  const { data } = parse(text);
  const wanted: Json = { hooks: [ourHook(target, agent)] };
  const hooks = (data.hooks as Json | undefined) ?? {};
  const status: HookStatus = { total: EVENTS[agent].length, current: 0, missing: [] };
  for (const event of EVENTS[agent]) {
    const groups = (hooks[event] as unknown[] | undefined) ?? [];
    if (groups.some((group) => isOurGroup(group, wanted))) {
      status.current += 1;
    } else if (!groups.some((group) => withoutOurs(group, agent).removed > 0)) {
      status.missing.push(event);
    }
  }
  return status;
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
