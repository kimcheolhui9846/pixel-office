#!/usr/bin/env node
/**
 * `pixel-office` command line.
 *
 *   pixel-office start [--port N]                   run the server in the foreground
 *   pixel-office url [folder]                       print the office address for one working folder
 *   pixel-office orca-open                          open this Orca worktree's office tab (run by the hooks)
 *   pixel-office orca-open                            Orca 터미널에서: 이 worktree의 사무실 탭을 Orca 브라우저에 엽니다
                                                    (에이전트 훅이 자동으로 실행, 서버가 없으면 띄움)
  pixel-office simulate [--loops N] [--speed X]   post the demo events to a running server
 *   pixel-office init [--agent A] [--dry-run] [--yes] [--windows-home P]   add our hooks
 *   pixel-office uninit [--agent A] [--dry-run] [--yes]   remove them again
 *
 * Messages for the user are Korean; code comments are English.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DEMO_CWD, DEMO_LOOP_MS, DEMO_SCRIPT, officeUrl } from "@pixel-office/core";
import {
  DEFAULT_PORT,
  homeDir,
  PortInUseError,
  readServerInfo,
  type ServerInfo,
  startServer,
  TOKEN_HEADER,
} from "@pixel-office/core/server";

import { defaultIo, runInit } from "./init.js";
import { openOfficeTab, orcaCommand, orcaWorktree, runOrca } from "./orca.js";

const USAGE = `사용법:
  pixel-office start [--port N]                     서버를 실행합니다 (기본 포트 ${DEFAULT_PORT}, Ctrl+C로 종료)
  pixel-office url [폴더]                          그 작업 폴더 전용 사무실 주소를 출력합니다 (기본: 현재 폴더)
  pixel-office simulate [--loops N] [--speed X]     실행 중인 서버에 데모 이벤트를 보냅니다 (기본 1회, 1배속)
  pixel-office init [--dry-run] [--yes]             에이전트 사용자 설정에 훅을 넣습니다
                                                    Claude Code: ~/.claude/settings.json, Codex: ~/.codex/hooks.json
                                                    바꿀 내용을 diff로 먼저 보여 주고, 확인한 뒤 백업하고 씁니다
      --agent <claude|codex|both>                   대상 에이전트 (기본 both, Codex 폴더가 없으면 Codex는 건너뜀)
      --windows-home <경로>                         WSL에서: Windows 사용자 폴더 (예: /mnt/c/Users/이름)
  pixel-office uninit [--dry-run] [--yes]           init이 넣은 훅만 지웁니다 (--agent도 씀)

환경 변수:
  PIXEL_OFFICE_HOME   server.json과 백업을 둘 폴더 (기본 ~/.pixel-office)
  CLAUDE_CONFIG_DIR   Claude Code 설정 폴더 (기본 ~/.claude)
  PIXEL_OFFICE_ORCA_OPEN=0   Orca에서 사무실 탭을 자동으로 열지 않습니다`;

const NO_SERVER = "실행 중인 Pixel Office 서버가 없습니다. 먼저 `pixel-office start`를 실행하세요.";

class UsageError extends Error {}

/** Prints the address of the office for one folder; the port comes from a running server. */
function url(args: string[]): number {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true, strict: true });
  if (positionals.length > 1) {
    throw new UsageError("폴더는 하나만 줄 수 있습니다.");
  }
  const folder = resolve(positionals[0] ?? process.cwd());
  const info = readServerInfo(homeDir());
  console.log(officeUrl(info?.port ?? DEFAULT_PORT, folder));
  if (info === null) {
    console.error(NO_SERVER);
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "start":
      return start(rest);
    case "simulate":
      return simulate(rest);
    case "url":
      return url(rest);
    case "orca-open":
      return orcaOpen(rest);
    case "init":
    case "uninit":
      return init(command, rest);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return command === undefined ? 2 : 0;
    default:
      throw new UsageError(`알 수 없는 명령입니다: ${command}`);
  }
}

function intOption(value: string | undefined, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const n = Number(value);
  if (!/^\d+$/.test(value) || n < min || n > max) {
    throw new UsageError(`--${name} 값은 ${min}부터 ${max}까지의 정수여야 합니다: ${value}`);
  }
  return n;
}

function uiDir(): string | undefined {
  try {
    const pkg = createRequire(import.meta.url).resolve("@pixel-office/ui/package.json");
    const web = join(dirname(pkg), "dist", "web");
    return existsSync(join(web, "index.html")) ? web : undefined;
  } catch {
    return undefined;
  }
}

async function start(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { port: { type: "string" } }, strict: true });
  // 0 asks the OS for a free port (used by tests)
  const port = intOption(values.port, "port", 0, 65_535, DEFAULT_PORT);
  const staticDir = uiDir();
  if (!staticDir) {
    console.error("경고: 화면 파일(packages/ui/dist/web)이 없습니다. `npm run build`를 먼저 실행하세요. API만 동작합니다.");
  }
  let server;
  try {
    server = await startServer({
      port,
      ...(staticDir ? { staticDir } : {}),
      log: (line) => console.error(line),
    });
  } catch (error) {
    if (error instanceof PortInUseError) {
      console.error(
        `포트 ${error.port}을(를) 이미 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끄거나 --port로 다른 포트를 지정하세요.`,
      );
      return 1;
    }
    throw error;
  }
  console.log(`Pixel Office 서버: ${server.url}`);
  console.log(`서버 정보: ${join(server.home, "server.json")}`);
  console.log("종료하려면 Ctrl+C를 누르세요.");

  return new Promise<number>((done) => {
    let stopping = false;
    const stop = () => {
      if (stopping) {
        return;
      }
      stopping = true;
      console.log("서버를 종료합니다.");
      server.close().then(
        () => done(0),
        (error: unknown) => {
          console.error(`종료 중 오류: ${(error as Error).message}`);
          done(1);
        },
      );
    };
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
      process.on(signal, stop);
    }
  });
}

async function health(info: ServerInfo): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/health`, { signal: AbortSignal.timeout(2_000) });
    const body = (await res.json()) as { ok?: unknown; name?: unknown };
    return res.ok && body.ok === true && body.name === "pixel-office";
  } catch {
    return false;
  }
}

/**
 * The port of a running server; starts `pixel-office start` detached when none answers and
 * waits up to 8 s for it. Null when nothing comes up.
 */
async function ensureServer(): Promise<number | null> {
  const home = homeDir();
  const current = readServerInfo(home);
  if (current !== null && (await health(current))) {
    return current.port;
  }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "start"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {});
  child.unref();
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    await sleepUntil(Date.now() + 200);
    const info = readServerInfo(home);
    if (info !== null && (await health(info))) {
      return info.port;
    }
  }
  return null;
}

const ORCA_RESULT: Record<string, string> = {
  exists: "이 worktree의 사무실 탭이 이미 열려 있습니다.",
  created: "Orca 브라우저에 사무실 탭을 열었습니다.",
  "orca-unavailable": "Orca CLI에 연결하지 못했습니다. Orca가 실행 중인지 확인하세요.",
  failed: "Orca 브라우저 탭을 만들지 못했습니다.",
};

/** Opens the office of the Orca worktree this terminal belongs to. */
async function orcaOpen(args: string[]): Promise<number> {
  parseArgs({ args, options: {}, allowPositionals: false, strict: true });
  const worktree = orcaWorktree(process.env);
  if (worktree === null) {
    console.error("Orca 터미널 밖입니다(ORCA_WORKTREE_ID가 없음). Orca worktree의 터미널에서 실행하세요.");
    return 1;
  }
  const port = await ensureServer();
  if (port === null) {
    console.error(`서버를 시작하지 못했습니다. 포트 ${DEFAULT_PORT}을 다른 프로그램이 쓰는지 확인하세요.`);
    return 1;
  }
  const result = openOfficeTab(worktree, port, runOrca(orcaCommand(process.env)));
  const text = ORCA_RESULT[result] ?? result;
  if (result === "exists" || result === "created") {
    console.log(text);
    return 0;
  }
  console.error(text);
  return 1;
}

const sleepUntil = (at: number) =>
  new Promise<void>((ok) => setTimeout(ok, Math.max(0, at - Date.now())));

async function simulate(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { loops: { type: "string" }, speed: { type: "string" } },
    strict: true,
  });
  const loops = intOption(values.loops, "loops", 1, 1_000, 1);
  const speed = values.speed === undefined ? 1 : Number(values.speed);
  if (!Number.isFinite(speed) || speed <= 0 || speed > 100) {
    throw new UsageError(`--speed 값은 0보다 크고 100 이하인 수여야 합니다: ${values.speed}`);
  }

  const info = readServerInfo(homeDir());
  if (!info || !(await health(info))) {
    console.error(NO_SERVER);
    return 1;
  }
  console.log(`데모 이벤트를 보냅니다: ${loops}회, ${speed}배속 (http://127.0.0.1:${info.port}/)`);

  let sent = 0;
  for (let loop = 0; loop < loops; loop += 1) {
    const begin = Date.now();
    for (const step of DEMO_SCRIPT) {
      await sleepUntil(begin + step.at / speed);
      let res: Response;
      try {
        res = await fetch(`http://127.0.0.1:${info.port}/event`, {
          method: "POST",
          headers: { "content-type": "application/json", [TOKEN_HEADER]: info.token },
          body: JSON.stringify({ ...step.event, cwd: DEMO_CWD, ts: Date.now() }),
          signal: AbortSignal.timeout(2_000),
        });
      } catch {
        console.error(`서버에 연결하지 못했습니다. ${NO_SERVER}`);
        return 1;
      }
      if (res.status !== 204) {
        console.error(`서버가 이벤트를 거부했습니다 (HTTP ${res.status}). 서버를 다시 시작한 뒤 시도하세요.`);
        return 1;
      }
      sent += 1;
    }
    if (loop < loops - 1) {
      await sleepUntil(begin + DEMO_LOOP_MS / speed);
    }
  }
  console.log(`완료: 이벤트 ${sent}개를 보냈습니다.`);
  return 0;
}

async function init(mode: "init" | "uninit", args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      "dry-run": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      "windows-home": { type: "string" },
      agent: { type: "string" },
    },
    strict: true,
  });
  const agent = values.agent ?? "both";
  if (agent !== "claude" && agent !== "codex" && agent !== "both") {
    throw new UsageError(`--agent 값은 claude, codex, both 중 하나여야 합니다: ${agent}`);
  }
  const hookPath = join(dirname(fileURLToPath(import.meta.url)), "hook.js");
  return runInit(
    mode,
    {
      dryRun: values["dry-run"] === true,
      yes: values.yes === true,
      agent,
      ...(values["windows-home"] !== undefined ? { windowsHome: values["windows-home"] } : {}),
    },
    defaultIo(hookPath),
  );
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      console.error(`${error instanceof UsageError ? error.message : "잘못된 옵션입니다."}\n\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`오류: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  },
);
