/**
 * `pixel-office doctor`: checks the build, the server and the hooks, and says what to run
 * next. Reads only; it never writes a file or starts anything. The server token is never
 * printed.
 *
 * Run inside an Orca terminal it checks Orca's copies of the settings, because Orca sets
 * `CLAUDE_CONFIG_DIR` and `CODEX_HOME` there (DESIGN.md 11).
 */
import { existsSync, readFileSync } from "node:fs";

import { officeUrl } from "@pixel-office/core";
import { DEFAULT_PORT, readServerInfo } from "@pixel-office/core/server";

import {
  claudeSettingsPath,
  codexHome,
  codexHooksPath,
  InitFailure,
  type InitIo,
  pixelOfficeHome,
  resolveTarget,
} from "./init.js";
import { orcaWorktree } from "./orca.js";
import { codexWrapperScript, type HookAgent, type HookTarget, hookStatus, SettingsError } from "./settings.js";

export type Level = "ok" | "warn" | "fail" | "info";

export interface Check {
  level: Level;
  title: string;
  detail: string;
}

export interface DoctorIo extends InitIo {
  cwd: string;
  nodeVersion: string;
  /** The web UI files were built (`packages/ui/dist/web/index.html`). */
  uiBuilt: boolean;
  /** `GET /health` on 127.0.0.1:port answers as Pixel Office. */
  health: (port: number) => Promise<boolean>;
}

export interface DoctorOptions {
  windowsHome?: string;
}

const MARK: Record<Level, string> = { ok: "[정상]", warn: "[주의]", fail: "[문제]", info: "[참고]" };

/** Shows the home folder as `~`. */
function tilde(path: string, home: string): string {
  return home !== "" && path.toLowerCase().startsWith(home.toLowerCase()) ? `~${path.slice(home.length)}` : path;
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function hookCheck(agent: HookAgent, path: string, target: HookTarget, home: string, inOrca: boolean): Check {
  const name = agent === "claude" ? "Claude Code 훅" : "Codex 훅";
  const where = tilde(path, home);
  let text: string | null;
  try {
    text = read(path);
  } catch (error) {
    return { level: "fail", title: name, detail: `${where}을(를) 읽지 못했습니다: ${(error as Error).message}` };
  }
  let status;
  try {
    status = hookStatus(text, target, agent);
  } catch (error) {
    if (error instanceof SettingsError) {
      return { level: "fail", title: name, detail: `${where}: ${error.message}. 파일을 고친 뒤 init을 실행하세요.` };
    }
    throw error;
  }
  // Orca copies the user settings into its own profile when the app starts, so inside Orca
  // the fix is init outside plus a restart; an init inside would be overwritten next time.
  const fix = inOrca
    ? `Orca 밖 터미널에서 \`pixel-office init --agent ${agent}\`를 실행한 뒤 Orca를 다시 시작하세요(Orca는 시작할 때 사용자 설정을 복사합니다).`
    : `다음을 실행하세요: \`pixel-office init --agent ${agent}\``;
  if (status.current === status.total) {
    return { level: "ok", title: name, detail: `${where}에 이벤트 ${status.total}개 모두 들어 있습니다.` };
  }
  if (status.missing.length === status.total) {
    return { level: "fail", title: name, detail: `${where}에 Pixel Office 훅이 없습니다. ${fix}` };
  }
  const missing = status.missing.length > 0 ? ` 빠진 이벤트: ${status.missing.join(", ")}.` : "";
  return {
    level: "warn",
    title: name,
    detail: `${where}의 훅이 지금 빌드와 다릅니다(저장소나 node를 옮겼거나 새 이벤트가 생김).${missing} ${fix}`,
  };
}

function wrapperCheck(target: HookTarget, home: string): Check | null {
  if (target.codexWrapper === undefined) {
    return null;
  }
  const where = tilde(target.codexWrapper, home);
  let text: string | null;
  let wanted: string;
  try {
    text = read(target.codexWrapper);
    wanted = codexWrapperScript(target);
  } catch (error) {
    return { level: "fail", title: "Codex 훅 래퍼", detail: `${where}: ${(error as Error).message}` };
  }
  if (text === wanted) {
    return { level: "ok", title: "Codex 훅 래퍼", detail: where };
  }
  return {
    level: "warn",
    title: "Codex 훅 래퍼",
    detail: `${where}이(가) ${text === null ? "없습니다" : "지금 빌드와 다릅니다"}. \`pixel-office init --agent codex\`를 실행하세요.`,
  };
}

export async function runDoctor(options: DoctorOptions, io: DoctorIo): Promise<Check[]> {
  const checks: Check[] = [];
  const home = io.homedir();
  const major = Number(/^v?(\d+)/.exec(io.nodeVersion)?.[1] ?? 0);
  checks.push(
    major >= 20
      ? { level: "ok", title: "Node.js", detail: io.nodeVersion }
      : { level: "fail", title: "Node.js", detail: `${io.nodeVersion}. 20 이상이 필요합니다.` },
  );
  checks.push(
    io.uiBuilt
      ? { level: "ok", title: "화면 파일", detail: "빌드되어 있습니다." }
      : { level: "fail", title: "화면 파일", detail: "없습니다. 저장소에서 `npm run build`를 실행하세요." },
  );

  const poHome = pixelOfficeHome(io.env, home);
  const info = readServerInfo(poHome);
  let port: number | undefined;
  if (info === null) {
    checks.push({
      level: "info",
      title: "서버",
      detail: "꺼져 있습니다. VS Code 확장이나 Orca 훅이 필요할 때 띄우고, 직접 띄우려면 `pixel-office start`를 실행하세요.",
    });
  } else if (await io.health(info.port)) {
    port = info.port;
    checks.push({ level: "ok", title: "서버", detail: `http://127.0.0.1:${info.port}/ 에서 응답합니다.` });
  } else {
    checks.push({
      level: "warn",
      title: "서버",
      detail: `server.json은 포트 ${info.port}을(를) 가리키지만 응답이 없습니다. 꺼진 서버의 기록이면 다음 실행 때 바뀝니다.`,
    });
  }

  const orca = orcaWorktree(io.env);
  let target: HookTarget | null = null;
  try {
    target = resolveTarget({ dryRun: true, yes: false, ...(options.windowsHome ? { windowsHome: options.windowsHome } : {}) }, {
      ...io,
      out: () => {},
    });
  } catch (error) {
    if (!(error instanceof InitFailure)) {
      throw error;
    }
    checks.push({ level: "fail", title: "훅", detail: error.message.replace(/\n/g, " ") });
  }
  if (target !== null) {
    checks.push(hookCheck("claude", claudeSettingsPath(io.env, home), target, home, orca !== null));
    if (existsSync(codexHome(io.env, home))) {
      checks.push(hookCheck("codex", codexHooksPath(io.env, home), target, home, orca !== null));
      const wrapper = wrapperCheck(target, home);
      if (wrapper !== null) {
        checks.push(wrapper);
      }
      checks.push({
        level: "info",
        title: "Codex 신뢰",
        detail: "Codex 안에서 `/hooks`로 Pixel Office 훅을 신뢰했는지는 여기서 알 수 없습니다. init 뒤에 한 번 확인하세요.",
      });
    } else {
      checks.push({ level: "info", title: "Codex 훅", detail: `${tilde(codexHome(io.env, home), home)} 폴더가 없어 건너뜁니다.` });
    }
  }

  checks.push({
    level: "info",
    title: "작업 폴더",
    detail: `${tilde(io.cwd, home)} → ${officeUrl(port ?? info?.port ?? DEFAULT_PORT, io.cwd)}`,
  });
  checks.push(
    orca === null
      ? { level: "info", title: "Orca", detail: "Orca 터미널 밖입니다. Orca 안에서 실행하면 Orca가 쓰는 설정 사본을 점검합니다." }
      : {
          level: "info",
          title: "Orca",
          detail: `worktree ${tilde(orca.path, home)}. 위 훅 점검은 Orca가 쓰는 설정 사본을 본 결과입니다.`,
        },
  );
  return checks;
}

/** The report text and the exit code: 1 when any check failed, else 0. */
export function formatChecks(checks: Check[]): { text: string; code: number } {
  const lines = checks.map((c) => `${MARK[c.level]} ${c.title}: ${c.detail}`);
  const failed = checks.filter((c) => c.level === "fail").length;
  const warned = checks.filter((c) => c.level === "warn").length;
  lines.push(
    "",
    failed + warned === 0 ? "모두 정상입니다." : `문제 ${failed}개, 주의 ${warned}개. 위 안내대로 고친 뒤 다시 실행하세요.`,
  );
  return { text: lines.join("\n"), code: failed > 0 ? 1 : 0 };
}
