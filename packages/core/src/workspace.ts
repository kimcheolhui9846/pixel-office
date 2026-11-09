/**
 * Workspace scoping (step 6): one office per working folder. An Orca worktree or a VS Code
 * workspace folder is the root; the office for that root shows only the agent sessions whose
 * `cwd` is the root or inside it. Browser-safe and pure.
 *
 * Paths reach us in several spellings for the same folder: `C:\Users\me\repo` from a Windows
 * agent, `c:/Users/me/repo` from a browser URL, `/mnt/c/Users/me/repo` from an agent in WSL,
 * `\\wsl.localhost\Ubuntu\home\me\repo` from Windows looking into WSL. `normalizePath` maps
 * them to one form so that a prefix test is enough.
 */
import type { OfficeState, Session } from "./state.js";

/**
 * One spelling per folder:
 * - `\` becomes `/`, repeated `/` collapse, a trailing `/` goes (except at a root);
 * - a WSL mount `/mnt/<d>/...` becomes `<d>:/...`;
 * - a Windows view into WSL (`//wsl$/<distro>/...`, `//wsl.localhost/<distro>/...`) becomes
 *   the Linux path `/...` (the distro name is dropped: one machine rarely runs two distros
 *   with the same folders open);
 * - a drive path is lower-cased as a whole, because Windows paths are case-insensitive.
 *   Linux paths keep their case.
 */
export function normalizePath(path: string): string {
  let p = path.trim().replace(/\\/g, "/");
  const wsl = /^\/\/(?:wsl\$|wsl\.localhost)\/[^/]+(\/.*)?$/i.exec(p);
  if (wsl) {
    p = wsl[1] ?? "/";
  }
  p = p.replace(/\/{2,}/g, "/");
  const mount = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(p);
  if (mount) {
    p = `${mount[1]}:${mount[2] ?? "/"}`;
  }
  if (/^[a-zA-Z]:/.test(p)) {
    p = p.toLowerCase();
    if (p.length === 2) {
      p += "/";
    }
  }
  if (p.length > 1 && p.endsWith("/") && !/^[a-z]:\/$/.test(p)) {
    p = p.replace(/\/+$/, "");
  }
  return p;
}

/** True when `cwd` is the workspace folder itself or a folder inside it. */
export function inWorkspace(cwd: string, workspace: string): boolean {
  const c = normalizePath(cwd);
  const w = normalizePath(workspace);
  if (w === "" || c === "") {
    return false;
  }
  return c === w || c.startsWith(w.endsWith("/") ? w : `${w}/`);
}

/** The state with only the sessions of one workspace (all sessions when it is null). */
export function workspaceState(state: OfficeState, workspace: string | null): OfficeState {
  if (workspace === null) {
    return state;
  }
  const sessions: Record<string, Session> = {};
  for (const [key, session] of Object.entries(state.sessions)) {
    if (inWorkspace(session.cwd, workspace)) {
      sessions[key] = session;
    }
  }
  return { sessions, now: state.now };
}

/** The folder name shown for a workspace: the last path segment, as given. */
export function workspaceName(workspace: string): string {
  const parts = workspace.trim().replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || workspace.trim();
}

/**
 * The page address for one workspace. The folder is written with `/` and only characters
 * that need it are percent-encoded (`:` and `/` stay readable). There is a single query
 * parameter on purpose: Orca's CLI runs through cmd.exe, which would cut a URL at `&`.
 */
export function officeUrl(port: number, workspace: string): string {
  const folder = encodeURIComponent(workspace.replace(/\\/g, "/"))
    .replace(/%2F/gi, "/")
    .replace(/%3A/gi, ":");
  return `http://127.0.0.1:${port}/?workspace=${folder}`;
}
