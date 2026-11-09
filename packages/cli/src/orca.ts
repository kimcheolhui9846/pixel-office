/**
 * Orca: open the office of a worktree in Orca's built-in browser (step 8).
 *
 * Orca cannot run VS Code extensions, and its plugins cannot open browser tabs, so the agents'
 * own hooks start it: a hook that runs inside an Orca terminal sees `ORCA_WORKTREE_ID`
 * (`<repoId>::<worktree path>`). When an agent starts work there, the hook launches
 * `pixel-office orca-open` detached (the hook itself returns at once). That command starts the
 * server if none answers, then asks the Orca CLI for the worktree's browser tabs and creates
 * a `/?workspace=<worktree>` tab when there is none.
 *
 * Checks are spaced by `OPEN_INTERVAL_MS` per worktree (`orca-open.json` in the app home), so a
 * busy session does not run the Orca CLI on every prompt. A closed office tab comes back at
 * the next check; `PIXEL_OFFICE_ORCA_OPEN=0` turns the whole thing off.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { normalizePath, officeUrl } from "@pixel-office/core";

export const OPEN_INTERVAL_MS = 60_000;
const STATE_FILE = "orca-open.json";

export interface OrcaWorktree {
  /** The full Orca id, `<repoId>::<path>`. */
  id: string;
  /** The worktree folder. */
  path: string;
}

/** The Orca worktree this process runs in, from `ORCA_WORKTREE_ID`. */
export function orcaWorktree(env: NodeJS.ProcessEnv): OrcaWorktree | null {
  const id = env.ORCA_WORKTREE_ID?.trim();
  if (!id || /[\u0000-\u001f\u007f]/.test(id)) {
    return null;
  }
  const at = id.indexOf("::");
  const path = at > 0 ? id.slice(at + 2).trim() : "";
  return path === "" ? null : { id, path };
}

/** False when the user turned the Orca tab off. */
export function orcaOpenEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.PIXEL_OFFICE_ORCA_OPEN !== "0";
}

/**
 * The Orca CLI. `ORCA_CLI_COMMAND` when Orca exported it (WSL sessions); on Windows the
 * installed `orca.exe`; else `orca` (Windows and macOS PATH). On Linux bare `orca` is usually the GNOME screen reader, so `orca-ide`.
 */
export function orcaCommand(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  const given = env.ORCA_CLI_COMMAND?.trim();
  if (given) {
    return given;
  }
  if (platform === "win32" && env.LOCALAPPDATA) {
    const installed = join(env.LOCALAPPDATA, "Programs", "orca", "resources", "bin", "orca.exe");
    if (existsSync(installed)) {
      return installed;
    }
  }
  return platform === "linux" ? "orca-ide" : "orca";
}

type Seen = Record<string, number>;

function readSeen(home: string): Seen {
  try {
    const raw = JSON.parse(readFileSync(join(home, STATE_FILE), "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return {};
    }
    const seen: Seen = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        seen[key] = value;
      }
    }
    return seen;
  } catch {
    return {};
  }
}

/** True when this worktree was checked less than `OPEN_INTERVAL_MS` ago. */
export function recentlyChecked(home: string, worktreeId: string, now: number): boolean {
  const at = readSeen(home)[worktreeId];
  return at !== undefined && now - at >= 0 && now - at < OPEN_INTERVAL_MS;
}

/** Records a check; entries older than a day are dropped. */
export function markChecked(home: string, worktreeId: string, now: number): void {
  const seen = readSeen(home);
  for (const [key, at] of Object.entries(seen)) {
    if (now - at > 86_400_000) {
      delete seen[key];
    }
  }
  seen[worktreeId] = now;
  mkdirSync(home, { recursive: true });
  const target = join(home, STATE_FILE);
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(seen) + "\n");
  renameSync(temp, target);
}

/** Runs one Orca CLI command and returns its parsed `--json` output (null on any failure). */
export type OrcaRun = (args: string[]) => unknown;

export function runOrca(command: string): OrcaRun {
  return (args) => {
    // orca.cmd needs a shell on Windows; orca.exe and orca-ide do not. Arguments here are ours
    // (a URL whose special characters are percent-encoded and an Orca id), never user text.
    const result = spawnSync(command, [...args, "--json"], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
      shell: /\.cmd$/i.test(command),
    });
    if (result.status !== 0 || typeof result.stdout !== "string") {
      return null;
    }
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      return null;
    }
  };
}

/** True when `url` is our office page for `workspace` on `port`. */
export function isOfficeTab(url: unknown, port: number, workspace: string): boolean {
  if (typeof url !== "string") {
    return false;
  }
  try {
    const parsed = new URL(url);
    const folder = parsed.searchParams.get("workspace");
    return (
      (parsed.host === `127.0.0.1:${port}` || parsed.host === `localhost:${port}`) &&
      parsed.pathname === "/" &&
      folder !== null &&
      normalizePath(folder) === normalizePath(workspace)
    );
  } catch {
    return false;
  }
}

export type OpenResult = "exists" | "created" | "orca-unavailable" | "failed";

/** Creates the worktree's office tab in Orca unless one is open already. */
export function openOfficeTab(worktree: OrcaWorktree, port: number, run: OrcaRun): OpenResult {
  const selector = `id:${worktree.id}`;
  const listed = run(["tab", "list", "--worktree", selector]) as { ok?: unknown; result?: { tabs?: unknown } } | null;
  if (listed === null || listed.ok !== true || !Array.isArray(listed.result?.tabs)) {
    return "orca-unavailable";
  }
  const tabs = listed.result.tabs as { url?: unknown }[];
  if (tabs.some((tab) => isOfficeTab(tab.url, port, worktree.path))) {
    return "exists";
  }
  const created = run(["tab", "create", "--url", officeUrl(port, worktree.path), "--worktree", selector]) as {
    ok?: unknown;
  } | null;
  return created !== null && created.ok === true ? "created" : "failed";
}

/**
 * Called from the hook: when an agent starts work inside an Orca terminal and the worktree was
 * not checked lately, launch `<cli> orca-open` detached. Never throws, never waits.
 */
export function launchOrcaOpen(options: {
  env: NodeJS.ProcessEnv;
  home: string;
  cliPath: string;
  now: number;
  spawnFn?: typeof spawn;
}): boolean {
  try {
    const worktree = orcaWorktree(options.env);
    if (worktree === null || !orcaOpenEnabled(options.env) || !existsSync(options.cliPath)) {
      return false;
    }
    if (recentlyChecked(options.home, worktree.id, options.now)) {
      return false;
    }
    const child = (options.spawnFn ?? spawn)(process.execPath, [options.cliPath, "orca-open"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: options.env,
    });
    child.on("error", () => {});
    child.unref();
    // marked here, before the child runs, so the other agent's hook in the same moment skips
    markChecked(options.home, worktree.id, options.now);
    return true;
  } catch {
    return false;
  }
}
