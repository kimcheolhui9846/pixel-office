/**
 * `pixel-office init` and `uninit`: add or remove our hooks in Claude Code's user settings
 * (`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json`) and in Codex's user
 * hooks (`~/.codex/hooks.json`, or `$CODEX_HOME/hooks.json`).
 *
 * Flow, for each file in turn: read, compute the new text, print a unified diff, then stop
 * (`--dry-run`), ask (TTY), refuse with exit 64 (no TTY and no `--yes`), or apply. Applying
 * backs up the original to `<pixel-office home>/backups/<timestamp>/<name>` and writes the
 * new file atomically (temp file plus rename).
 *
 * `--agent both` (the default) skips Codex when its folder does not exist, so a machine
 * without Codex gets only the Claude hooks; `--agent codex` creates the file anyway.
 *
 * Everything that touches the machine comes in through `InitIo`, so tests run it against
 * temp folders with a fake WSL detector.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";
import { randomBytes } from "node:crypto";

import { unifiedDiff } from "./diff.js";
import {
  addOurHooks,
  type Change,
  CODEX_WRAPPER_NAME,
  codexCommand,
  codexWrapperScript,
  type HookAgent,
  type HookTarget,
  removeOurHooks,
  SettingsError,
} from "./settings.js";

/** Where the Windows Codex wrapper lives: next to server.json and the backups. */
function codexWrapperPath(io: InitIo): string {
  return join(pixelOfficeHome(io.env, io.homedir()), CODEX_WRAPPER_NAME);
}

export const EXIT_NEEDS_CONFIRMATION = 64;

export type AgentChoice = HookAgent | "both";

export interface InitOptions {
  dryRun: boolean;
  yes: boolean;
  /** Which agent's hooks to change. Default `both`. */
  agent?: AgentChoice;
  /** WSL only: the Windows user folder, as `/mnt/c/Users/<name>` or `C:\Users\<name>`. */
  windowsHome?: string;
}

export interface InitIo {
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** stdin and stdout are both terminals, so a question can be asked. */
  interactive: boolean;
  ask: (question: string) => Promise<string>;
  nodePath: string;
  hookPath: string;
  isWsl: () => boolean;
  /** The Windows user folder as a WSL path (`/mnt/c/Users/<name>`), or null. */
  windowsProfile: () => string | null;
  /** `wslpath -u`: a Windows path to a WSL path, or null. */
  toWslPath: (windowsPath: string) => string | null;
  now: () => Date;
  /** Defaults to `process.platform`; decides how the Codex command string is quoted. */
  platform?: NodeJS.Platform;
}

export function claudeSettingsPath(env: NodeJS.ProcessEnv, home: string): string {
  const configDir = env.CLAUDE_CONFIG_DIR;
  return configDir && configDir.trim() !== ""
    ? join(configDir, "settings.json")
    : join(home, ".claude", "settings.json");
}

/** Codex's home folder: `$CODEX_HOME`, else `~/.codex`. */
export function codexHome(env: NodeJS.ProcessEnv, home: string): string {
  const configured = env.CODEX_HOME;
  return configured && configured.trim() !== "" ? configured : join(home, ".codex");
}

export function codexHooksPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(codexHome(env, home), "hooks.json");
}

function pixelOfficeHome(env: NodeJS.ProcessEnv, home: string): string {
  const override = env.PIXEL_OFFICE_HOME;
  return override && override.trim() !== "" ? override : join(home, ".pixel-office");
}

/** Detects WSL: `WSL_DISTRO_NAME` is set or `/proc/version` mentions Microsoft. */
export function detectWsl(env: NodeJS.ProcessEnv = process.env): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  if (env.WSL_DISTRO_NAME) {
    return true;
  }
  try {
    return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

export function wslPath(windowsPath: string): string | null {
  const result = spawnSync("wslpath", ["-u", windowsPath], { encoding: "utf8", timeout: 5_000 });
  const out = result.status === 0 ? result.stdout.trim() : "";
  return out.startsWith("/") ? out : null;
}

/** `cmd.exe /c echo %USERPROFILE%` then `wslpath -u`. Runs from /mnt/c to avoid the UNC warning. */
export function windowsProfileFromCmd(): string | null {
  const result = spawnSync("cmd.exe", ["/c", "echo %USERPROFILE%"], {
    encoding: "utf8",
    timeout: 5_000,
    ...(existsSync("/mnt/c") ? { cwd: "/mnt/c" } : {}),
  });
  const value = result.status === 0 ? result.stdout.trim() : "";
  if (!/^[A-Za-z]:\\/.test(value)) {
    return null;
  }
  return wslPath(value);
}

export function defaultIo(hookPath: string): InitIo {
  return {
    env: process.env,
    homedir,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: async (question) => {
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    nodePath: process.execPath,
    hookPath,
    isWsl: () => detectWsl(process.env),
    windowsProfile: windowsProfileFromCmd,
    toWslPath: wslPath,
    now: () => new Date(),
  };
}

class InitFailure extends Error {}

function resolveTarget(options: InitOptions, io: InitIo): HookTarget {
  if (!existsSync(io.hookPath)) {
    throw new InitFailure(`훅 파일이 없습니다: ${io.hookPath}\n먼저 \`npm run build\`를 실행하세요.`);
  }
  const target: HookTarget = { nodePath: io.nodePath, hookPath: io.hookPath };
  if ((io.platform ?? process.platform) === "win32") {
    target.windows = true;
    target.codexWrapper = codexWrapperPath(io);
  }
  if (!io.isWsl()) {
    if (options.windowsHome !== undefined) {
      throw new InitFailure("--windows-home은 WSL 안에서 실행할 때만 씁니다.");
    }
    return target;
  }
  let profile: string | null;
  if (options.windowsHome !== undefined) {
    const given = options.windowsHome.trim();
    profile = given.startsWith("/") ? given : io.toWslPath(given);
  } else {
    profile = io.windowsProfile();
  }
  if (profile === null || !profile.startsWith("/")) {
    throw new InitFailure(
      "WSL 안에서 실행 중인데 Windows 사용자 폴더를 찾지 못했습니다.\n" +
        "`--windows-home /mnt/c/Users/<이름>`으로 직접 지정하세요.",
    );
  }
  target.pixelOfficeHome = posix.join(profile.replace(/\/+$/, ""), ".pixel-office");
  io.out(`WSL 안에서 실행 중입니다. 훅이 Windows 쪽 서버 정보를 읽도록 PIXEL_OFFICE_HOME=${target.pixelOfficeHome}을 넣습니다.`);
  return target;
}

function readSettings(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function stamp(date: Date): string {
  // 2026-11-09T02-10-00-123Z: no colons, so it is a valid Windows folder name
  return date.toISOString().replace(/[:.]/g, "-");
}

/** One backup folder per run, shared by the files that run changes. */
interface BackupFolder {
  dir?: string;
}

/** A new, empty folder under `<home>/backups` named after the time. */
function newBackupFolder(home: string, now: Date): string {
  const root = join(home, "backups");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (let n = 0; ; n += 1) {
    const dir = join(root, n === 0 ? stamp(now) : `${stamp(now)}-${n}`);
    try {
      mkdirSync(dir, { mode: 0o700 });
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST" && n < 100) {
        continue;
      }
      throw error;
    }
  }
}

/** Copies the settings file byte for byte into this run's backup folder; returns its path. */
function backup(settingsPath: string, home: string, now: Date, name: string, folder: BackupFolder): string {
  folder.dir ??= newBackupFolder(home, now);
  const file = join(folder.dir, name);
  copyFileSync(settingsPath, file);
  return file;
}

/** Temp file in the same folder, then rename, so Claude Code never reads half a file. */
function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  let mode: number | undefined;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    mode = undefined;
  }
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, text, { flag: "wx", ...(mode === undefined ? {} : { mode }) });
    if (mode !== undefined && process.platform !== "win32") {
      chmodSync(temp, mode);
    }
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

interface FileSpec {
  agent: HookAgent;
  label: string;
  path: string;
  backupName: string;
}

function files(options: InitOptions, io: InitIo, mode: "init" | "uninit"): FileSpec[] {
  const home = io.homedir();
  const choice = options.agent ?? "both";
  const specs: FileSpec[] = [];
  if (choice === "claude" || choice === "both") {
    specs.push({
      agent: "claude",
      label: "Claude Code 사용자 설정",
      path: claudeSettingsPath(io.env, home),
      backupName: "claude-settings.json",
    });
  }
  if (choice === "codex" || choice === "both") {
    const folder = codexHome(io.env, home);
    if (choice === "both" && !existsSync(folder)) {
      if (mode === "init") {
        io.out(`Codex 폴더(${folder})가 없어서 Codex 훅은 건너뜁니다. 넣으려면 --agent codex로 실행하세요.`);
      }
    } else {
      specs.push({
        agent: "codex",
        label: "Codex 사용자 훅",
        path: codexHooksPath(io.env, home),
        backupName: "codex-hooks.json",
      });
    }
  }
  return specs;
}

const AFTER_APPLY: Record<HookAgent, string[]> = {
  claude: ["실행 중인 Claude Code 세션도 대개 바로 반영합니다. 반영되지 않으면 세션을 다시 시작하세요."],
  codex: [
    "Codex는 새 훅이나 바뀐 훅을 신뢰하기 전에는 실행하지 않습니다. Codex에서 `/hooks`를 열어 Pixel Office 훅을 신뢰하세요.",
    "이미 실행 중인 Codex 세션에는 다시 시작해야 반영될 수 있습니다.",
  ],
};

export async function runInit(mode: "init" | "uninit", options: InitOptions, io: InitIo): Promise<number> {
  try {
    if (mode === "uninit" && options.windowsHome !== undefined) {
      throw new InitFailure("--windows-home은 init에서만 씁니다.");
    }
    const specs = files(options, io, mode);
    const target = mode === "init" ? resolveTarget(options, io) : undefined;
    let worst = 0;
    const folder: BackupFolder = {};
    for (const [index, spec] of specs.entries()) {
      if (index > 0) {
        io.out("");
      }
      worst = Math.max(worst, await runOne(mode, spec, target, options, io, folder));
    }
    return worst;
  } catch (error) {
    if (error instanceof InitFailure) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}

async function runOne(
  mode: "init" | "uninit",
  spec: FileSpec,
  target: HookTarget | undefined,
  options: InitOptions,
  io: InitIo,
  folder: BackupFolder,
): Promise<number> {
  const settingsPath = spec.path;
  try {
    io.out(`${spec.label}: ${settingsPath}`);

    // Windows Codex wrapper: written on init, removed on uninit. Its text holds the node and
    // hook.js paths, so a moved repo changes only the wrapper, not the trusted hook command.
    const wrapperPath = codexWrapperPath(io);
    const wrapperBefore = spec.agent === "codex" ? readSettings(wrapperPath) : null;
    let wrapperAfter: string | null = wrapperBefore;
    if (spec.agent === "codex") {
      if (target?.windows === true) {
        try {
          codexCommand(target);
          wrapperAfter = codexWrapperScript(target);
        } catch (error) {
          if (error instanceof SettingsError) {
            throw new InitFailure(`${error.message}\n파일을 바꾸지 않았습니다.`);
          }
          throw error;
        }
      } else if (target === undefined) {
        wrapperAfter = null;
      }
    }
    const wrapperChanged = wrapperAfter !== wrapperBefore;

    const before = readSettings(settingsPath);
    let change: Change;
    try {
      change = target ? addOurHooks(before, target, spec.agent) : removeOurHooks(before, spec.agent);
    } catch (error) {
      if (error instanceof SettingsError) {
        throw new InitFailure(`설정 파일을 이해할 수 없습니다: ${error.message}\n파일을 바꾸지 않았습니다.`);
      }
      throw error;
    }

    if (!change.changed && !wrapperChanged) {
      io.out(
        mode === "init"
          ? "바꿀 것이 없습니다. Pixel Office 훅이 이미 들어 있습니다."
          : "바꿀 것이 없습니다. Pixel Office 훅이 없습니다.",
      );
      return 0;
    }
    if (change.changed) {
      if (before === null) {
        io.out("설정 파일이 없어서 Pixel Office 훅만 담은 새 파일을 만듭니다.");
      }
      io.out("");
      io.out(unifiedDiff(before ?? "", change.after, `${settingsPath} (현재)`, `${settingsPath} (적용 후)`).trimEnd());
      io.out("");
    }
    if (wrapperChanged) {
      io.out(
        wrapperAfter === null
          ? `Codex 훅 래퍼를 지웁니다: ${wrapperPath}`
          : `Codex 훅 래퍼(${wrapperBefore === null ? "새 파일" : "내용 변경"}): ${wrapperPath}`,
      );
      io.out("");
      io.out(
        unifiedDiff(
          (wrapperBefore ?? "").replace(/\r\n/g, "\n"),
          (wrapperAfter ?? "").replace(/\r\n/g, "\n"),
          `${wrapperPath} (현재)`,
          `${wrapperPath} (적용 후)`,
        ).trimEnd(),
      );
      io.out("");
    }

    if (options.dryRun) {
      io.out("--dry-run: 파일을 바꾸지 않았습니다.");
      return 0;
    }
    if (!options.yes) {
      if (!io.interactive) {
        io.err("터미널이 아니라서 확인을 받을 수 없습니다. 적용하려면 --yes를 붙이세요. 파일을 바꾸지 않았습니다.");
        return EXIT_NEEDS_CONFIRMATION;
      }
      const answer = (await io.ask("적용할까요? (y/N) ")).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        io.out("취소했습니다. 파일을 바꾸지 않았습니다.");
        return 1;
      }
    }

    // the file may have changed while we waited for the answer
    if (readSettings(settingsPath) !== before) {
      throw new InitFailure("확인하는 동안 설정 파일이 바뀌었습니다. 다시 실행하세요. 파일을 바꾸지 않았습니다.");
    }
    // on init the wrapper goes first, so the hook never points at a missing file; on uninit
    // the hooks go first, for the same reason
    if (wrapperChanged && wrapperAfter !== null) {
      writeAtomic(wrapperPath, wrapperAfter);
      io.out(`Codex 훅 래퍼를 썼습니다: ${wrapperPath}`);
    }
    if (change.changed) {
      const poHome = pixelOfficeHome(io.env, io.homedir());
      const backupPath = before === null ? null : backup(settingsPath, poHome, io.now(), spec.backupName, folder);
      writeAtomic(settingsPath, change.after);
      io.out(`적용했습니다: ${settingsPath}`);
      io.out(backupPath === null ? "원래 파일이 없어서 백업하지 않았습니다." : `원래 파일 백업: ${backupPath}`);
    }
    if (wrapperChanged && wrapperAfter === null) {
      rmSync(wrapperPath, { force: true });
      io.out(`Codex 훅 래퍼를 지웠습니다: ${wrapperPath}`);
    }
    if (mode === "init" && change.changed) {
      for (const line of AFTER_APPLY[spec.agent]) {
        io.out(line);
      }
    }
    return 0;
  } catch (error) {
    if (error instanceof InitFailure) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}
