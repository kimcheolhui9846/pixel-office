/**
 * Which work zone a hook event belongs in (step 9c). Pure and browser-safe.
 *
 * This is an estimate from the tool an agent calls. File paths and commands are read here
 * only to pick a zone (a document or source file, a read-only or a real command); they never
 * leave this function. Unknown tools give `undefined`, so the person stays where they are.
 *
 *  plan    instructions just arrived, plan mode, to-do lists, questions to the user, handing
 *          work to a subagent
 *  design  writing documents: .md/.rst/.txt/.adoc files, or files under docs/, design/, adr/,
 *          spec/ or rfc/ folders
 *  build   editing or creating any other file
 *  run     running commands (tests included)
 *  review  reading and searching files, web lookups, read-only commands (cat, grep, git diff...)
 */
import type { Zone } from "./state.js";

const PLAN_TOOLS = new Set([
  "TodoWrite",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
  "EnterPlanMode",
  "ExitPlanMode",
  "AskUserQuestion",
  "Task",
  "Agent",
  "update_plan",
]);
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "apply_patch"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell", "shell", "local_shell", "exec_command", "unified_exec"]);
const READ_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "NotebookRead",
  "WebFetch",
  "WebSearch",
  "web_search",
  "view_image",
  "read_file",
  "list_dir",
  "grep_files",
]);

const DOC_FILE = /\.(md|mdx|markdown|rst|txt|adoc)$/i;
const DOC_FOLDER = /(^|[\\/])(docs?|design|adrs?|specs?|rfcs?)[\\/]/i;
const READ_ONLY = /^\s*(cat|head|tail|less|more|ls|dir|tree|wc|grep|rg|find|fd|Get-Content|gc|Select-String|Get-ChildItem|gci|type|git\s+(diff|log|show|status|blame|grep))(\s|$)/i;

/** A document rather than source code, judged by the path only. */
export function isDocPath(path: string): boolean {
  return DOC_FILE.test(path) || DOC_FOLDER.test(path);
}

/** File paths a tool call edits: `file_path`/`notebook_path`, or the files of an apply_patch. */
function editedPaths(input: unknown): string[] {
  if (typeof input === "string") {
    return patchPaths(input);
  }
  if (typeof input !== "object" || input === null) {
    return [];
  }
  const i = input as Record<string, unknown>;
  for (const key of ["file_path", "notebook_path", "path"]) {
    if (typeof i[key] === "string") {
      return [i[key] as string];
    }
  }
  for (const key of ["patch", "input", "command"]) {
    if (typeof i[key] === "string") {
      return patchPaths(i[key] as string);
    }
  }
  return [];
}

function patchPaths(patch: string): string[] {
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1]!.trim());
}

function commandText(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (typeof input === "object" && input !== null) {
    const c = (input as Record<string, unknown>).command ?? (input as Record<string, unknown>).cmd;
    if (typeof c === "string") {
      return c;
    }
    if (Array.isArray(c)) {
      return c.filter((x) => typeof x === "string").join(" ");
    }
  }
  return "";
}

/** The zone of one tool call, or undefined for a tool we cannot place. */
export function zoneOfTool(toolName: string | undefined, toolInput: unknown): Zone | undefined {
  if (toolName === undefined) {
    return undefined;
  }
  if (PLAN_TOOLS.has(toolName)) {
    return "plan";
  }
  if (EDIT_TOOLS.has(toolName)) {
    const paths = editedPaths(toolInput);
    return paths.length > 0 && paths.every(isDocPath) ? "design" : "build";
  }
  if (SHELL_TOOLS.has(toolName)) {
    // the first command of a chain decides; `cat x && npm test` counts as a run
    const command = commandText(toolInput);
    return READ_ONLY.test(command) && !/(&&|\|\||;)/.test(command) ? "review" : "run";
  }
  if (READ_TOOLS.has(toolName)) {
    return "review";
  }
  return undefined;
}
