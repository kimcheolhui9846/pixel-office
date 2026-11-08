/**
 * The app's home folder and the `server.json` file that tells hooks and the CLI where the
 * running server is. Node only.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ServerInfo {
  port: number;
  token: string;
  pid: number;
  /** ISO 8601. */
  startedAt: string;
}

/** `PIXEL_OFFICE_HOME`, else `~/.pixel-office`. */
export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PIXEL_OFFICE_HOME;
  return override && override.trim() !== "" ? override : join(homedir(), ".pixel-office");
}

export function serverInfoPath(home: string): string {
  return join(home, "server.json");
}

/**
 * Writes `server.json` atomically with owner-only permissions: a new temp file is created
 * with mode 0600 and renamed over the old one, so a reader never sees half a file and an
 * old file's looser mode is not kept. (On Windows the mode bits are ignored; the file is
 * protected by the user profile's ACL.)
 */
export function writeServerInfo(home: string, info: ServerInfo): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const target = serverInfoPath(home);
  const temp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(info, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Reads and checks `server.json`; returns null when it is missing or malformed. */
export function readServerInfo(home: string): ServerInfo | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(serverInfoPath(home), "utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.port !== "number" ||
    !Number.isInteger(r.port) ||
    r.port < 1 ||
    r.port > 65_535 ||
    typeof r.token !== "string" ||
    !/^[0-9a-f]{64}$/.test(r.token) ||
    typeof r.pid !== "number" ||
    typeof r.startedAt !== "string"
  ) {
    return null;
  }
  return { port: r.port, token: r.token, pid: r.pid, startedAt: r.startedAt };
}

/**
 * Removes `server.json` only if it still describes this server (same pid and token). A
 * newer server that overwrote the file keeps it.
 */
export function removeServerInfo(home: string, ours: Pick<ServerInfo, "pid" | "token">): boolean {
  const current = readServerInfo(home);
  if (!current || current.pid !== ours.pid || current.token !== ours.token) {
    return false;
  }
  rmSync(serverInfoPath(home), { force: true });
  return true;
}
