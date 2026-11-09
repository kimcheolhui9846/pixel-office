# Pixel Office 설계 (0단계 전제 확인 결과)

2026-11-09, Orca 1.4.253 (Windows 11), Claude Code, codex-cli 0.167.0 기준이다. "확인"은 이 PC에서 실제로 실행한 것, "문서"는 공식 문서나 소스에서 읽은 것, "미확인"은 아직 확인하지 못한 것이다.

## 1. 0단계 결과

| 질문 | 결과 | 근거 |
|---|---|---|
| Orca가 VS Code 확장을 로드하나 | 아니다. 편집기는 Monaco이고 자체 플러그인 체계(`orca-plugin.json`)만 있다 | 문서: stablyai/orca 이슈 #23820, #7754 |
| Orca 내장 브라우저 | 있다. `orca tab create --url http://127.0.0.1:<port> --split right`로 연 페이지에서 JS가 실행되고 `WebSocket`을 쓸 수 있었다 | 확인 |
| Orca 플러그인 패널에서 로컬 서버 접속 | 안 된다. 패널은 루프백을 포함한 네트워크가 막혀 있다 | 문서: Orca 플러그인 문서 |
| worktree 기본 위치 | `~/orca/workspaces/<레포>/<이름>`. 전역 `workspaceDir`와 레포별 `worktreeBasePath`로 바꿀 수 있다 | 문서: Orca 소스 |
| Orca의 에이전트 상태 | `orca worktree ps --json`의 `worktrees[].agents[]`에 `agentType`, `state`(working, blocked, waiting, done 등), `toolName`, `paneKey`, `stateStartedAt`이 있다 | 확인(필드 이름) |
| Orca 훅의 범위 | Orca는 사용자 범위(`~/.claude/settings.json`, `~/.codex/hooks.json`)에 훅을 넣지만, Orca 터미널 밖에서는 아무것도 하지 않는다. VS Code에서 돌린 에이전트는 Orca가 모른다 | 문서: Orca 훅 스크립트 |

## 2. 처음 설계에서 바꾼 것

1. **Orca 화면은 "로컬 서버 + 내장 브라우저"다.** Orca는 VS Code 확장을 돌리지 못하고, 플러그인 패널은 로컬 서버에 붙을 수 없다. 그래서 서버 하나, UI 하나를 두고 VS Code는 웹뷰로, Orca는 내장 브라우저 탭으로 같은 UI를 띄운다. Orca 플러그인 패널은 나중의 선택 사항이다.
2. **훅은 사용자 범위에 둔다(사용자 결정).** Orca가 worktree를 만들 때마다 프로젝트 설정을 고칠 필요가 없고, 레포 파일도 바뀌지 않는다. `pixel-office init`이 diff를 보여 주고, 백업한 뒤, 다른 훅(Orca, skill kit)을 지우지 않고 병합한다.
3. **신호 정정.**
   - Claude Code의 `PostToolUse`에는 종료 코드가 없다. 실패는 `PostToolUseFailure`의 `error` 첫 줄 `Exit code N`으로 판정한다. 권한 대기는 `Notification`(`permission_prompt` 등), 끝은 `Stop`, API 오류는 `StopFailure`다.
   - Codex는 `notify`(레거시, 한 칸뿐, 턴 끝에만 발생) 대신 공식 훅(`hooks.json`)을 쓴다. 처음 한 번 Codex 안에서 `/hooks`로 신뢰해야 한다.
   - 세션 로그와 파일 변경 감시는 훅이 없을 때의 보조(추정)다.
4. **자동으로 띄운다(사용자 요구).** VS Code나 Orca로 작업할 때마다 사무실이 떠야 한다.
   - VS Code: 확장이 시작할 때 서버에 연결하거나 서버를 띄우고 패널을 연다.
   - Orca: 에이전트 세션이 시작될 때 훅이 서버를 확인하고, Orca 터미널 안이면(`ORCA_PANE_KEY` 등) 그 worktree에 브라우저 탭을 한 번 연다. 구체적인 방법은 8단계에서 확인한다.

## 3. 아직 확인하지 못한 것

- Orca가 띄운 Codex가 세션 로그를 어디에 쓰는지(Orca 전용 `CODEX_HOME`).
- Orca 내장 브라우저에서 실제 WebSocket 연결(생성자는 있음을 확인).
- ~~Codex 훅에서 셸 명령의 종료 코드를 얻을 수 있는지.~~ 얻을 수 없다(8절, 소스 확인).

## 4. 상태 머신 (1단계, `packages/core/src/state.ts`)

- 세션마다 상태를 따로 둔다. 키는 `에이전트:세션 id`라서 두 에이전트의 id가 같아도 섞이지 않는다.
- `reduce(state, event)`는 순수 함수다. 시간은 이벤트의 `ts`로만 흐르고, 서버가 주기적으로 `tick` 이벤트를 보낸다.

| 이벤트 | 세션 상태 |
|---|---|
| `start`, `tool_start`, `tool_end`, `fs_burst` | working |
| `waiting` (권한 요청 등) | waiting. 사람이 답해야 하므로 시간이 지나도 풀리지 않는다 |
| `error` | alert |
| `success`, `stop` | success |

- success와 alert는 `holdMs`(기본 4초) 뒤에 idle로 돌아간다.
- working은 `idleAfterMs`(기본 30초) 동안 이벤트가 없으면 idle이 된다.
- idle은 `forgetAfterMs`(기본 30분) 뒤에 목록에서 지운다.
- 화면 전체 장면(`scene`)의 우선순위: 사람이 필요한 상태(alert, waiting) > 가장 최근에 일을 시작한 에이전트(CODEX_BUILDING 또는 CLAUDE_RUNNING) > SUCCESS > IDLE.
- 프롬프트의 `CLAUDE_ALERT`는 Codex의 오류에도 쓴다. 이때 `focus`가 `codex`라서 UI가 Codex 책상에 경고를 그린다.

## 5. UI 뼈대 (2단계, `packages/ui`)

- **번들러 없음.** TypeScript를 ES 모듈로 컴파일하고, `scripts/assemble.mjs`가 `dist/web/`에 `index.html`, UI 모듈, core 모듈을 모은다. 페이지는 import map으로 `@pixel-office/core`를 찾는다. VS Code 웹뷰와 Orca 브라우저가 모두 Chromium이라 같은 파일을 쓴다. esbuild는 설치할 때 스크립트(postinstall)를 실행해서 쓰지 않았다.
- **그리기는 순수 함수다.** `art(scene, {frame, reducedMotion, connected})`가 사각형과 글자 목록을 돌려주고, `main.ts`가 그것을 캔버스(160×96 논리 픽셀, 정수 배율)에 칠한다. 외부 이미지 에셋은 없다.
- **성능:** 10fps 고정 루프, 탭이 숨으면 멈춤, 그림이 같으면 다시 칠하지 않음. `prefers-reduced-motion`이면 애니메이션을 0프레임에 고정한다.
- **데모:** `?demo`는 20초 반복 시나리오로 장면 5개를 돈다. `?demo=6000`은 6초 시점에 고정한다(스크린숏용). `&`를 쓰지 않는 이유: Windows에서 `orca.cmd`가 `cmd.exe`를 거치면서 URL의 `&` 뒤를 잘랐다.
- 실제 에이전트 없이 서버로 가짜 이벤트를 보내는 `pixel-office simulate`는 3단계에서 만들었다(6절). 데모 대본은 3단계에서 `packages/core/src/demo.ts`로 옮겨 페이지와 CLI가 같은 이벤트를 쓴다.
- 스크린숏: `docs/screenshots/step2-*.png` (Orca 1.4.253 내장 브라우저).

## 6. 서버와 보안 (3단계)

- **위치.** 서버는 `packages/core/src/node/`에 있고 `@pixel-office/core/server`로 내보낸다. `assemble.mjs`는 core의 맨 위 파일만 복사하므로 브라우저는 서버 코드를 받지 않는다. `@pixel-office/core`(`src/index.ts`)는 그대로 브라우저에서 쓸 수 있다. 명령은 `packages/cli`의 `pixel-office`다.
- **주소.** `127.0.0.1`에만 연다. 기본 포트는 **47821**이고 `pixel-office start --port N`으로 바꾼다. 포트가 이미 쓰이고 있으면 다른 포트를 고르지 않고 이유를 말하고 끝난다(종료 코드 1). 훅과 페이지가 엉뚱한 포트를 찾지 않게 하려는 것이다.

| 경로 | 토큰 | 내용 |
|---|---|---|
| `GET /` 등 | 없음 | `packages/ui/dist/web`의 화면. `index.html`에 토큰 meta를 넣어 준다 |
| `GET /health` | 없음 | `{ok:true, name:"pixel-office", version}`. 훅과 `doctor`가 우리 서버인지 확인한다 |
| `POST /event` | `x-pixel-office-token` 헤더 | 이벤트 하나. 성공하면 204 |
| `/ws` (WebSocket) | `?token=` | 연결하자마자 한 번, 그 뒤 바뀔 때마다 `{scene, sessions}`를 보낸다. 서버가 보내기만 한다 |

- **WebSocket은 `ws` 8.22.2로 한다.** Node에는 WebSocket 서버가 내장되어 있지 않고, 프레임 해석기를 직접 쓰면 그 자체가 공격면이 된다. 그래서 검증된 라이브러리를 하나만 들였다. `ws`는 MIT이고, 의존성이 없고, 설치할 때 실행되는 스크립트가 없다. 사용자가 직접 설치했고 버전은 고정했다(`@types/ws` 8.18.2는 개발용). `packages/core`의 서버만 쓰고 브라우저는 내장 `WebSocket`을 쓴다.
- **업그레이드 확인.** `new WebSocketServer({ noServer: true, maxPayload: 1024 })`를 만들고 HTTP 서버의 `upgrade` 이벤트에서 직접 확인한 뒤에만 넘긴다. 순서는 다음과 같다. 실패하면 본문 없는 `HTTP/1.1 401 Unauthorized`, `403 Forbidden`, `503 Service Unavailable`과 `Connection: close`를 쓰고 소켓을 닫는다.
  1. Host가 정확히 `127.0.0.1:<포트>` 또는 `localhost:<포트>`가 아니면 403.
  2. Origin이 **반드시 있어야 하고** 우리 출처이거나 `allowedOrigins`에 있어야 한다. 아니면 403.
  3. 경로가 정확히 `/ws`가 아니면 403. 다른 경로는 업그레이드되지 않는다.
  4. `?token=`이 틀리거나 없으면 401.
  5. 이미 32개가 연결되어 있으면 503.
- **WebSocket에서 Origin이 필수인 이유.** 브라우저는 WebSocket에 CORS를 적용하지 않는다. 어느 사이트의 페이지든 `ws://127.0.0.1:47821/ws`를 열 수 있고, 사전 요청도 없다. 그래서 막는 것은 Origin 확인뿐이다. 브라우저는 WebSocket을 열 때 Origin을 늘 보내므로 Origin이 없는 요청은 브라우저가 아닌 것이고, 그런 프로그램은 토큰이 있어도 거부한다. 일반 HTTP 요청은 CORS가 막아 주므로 Origin이 없어도 된다.
- **서버는 보내기만 한다.** 클라이언트 메시지는 읽지 않고 버린다. 1024바이트보다 큰 프레임이 오면 `ws`가 1009로 연결을 끊는다. 30초마다 ping을 보내고, 앞의 ping에 pong이 없던 클라이언트는 끊는다.
- **토큰.** 시작할 때마다 `crypto`로 32바이트 토큰(16진수 64자)을 만들고 `<home>/server.json`에 `{port, token, pid, startedAt}`를 쓴다. `<home>`은 기본 `~/.pixel-office`이고 `PIXEL_OFFICE_HOME`으로 바꾼다. 파일은 0600 권한의 임시 파일로 만든 뒤 이름을 바꿔 덮어쓴다. Windows는 권한 비트를 무시하므로 사용자 프로필 폴더의 ACL에 기댄다. 정상 종료할 때는 파일의 pid와 토큰이 아직 우리 것일 때만 지운다. 다른 서버가 덮어쓴 파일은 남긴다. 토큰은 SHA-256으로 길이를 맞춘 뒤 `timingSafeEqual`로 비교한다.
- **페이지에 토큰을 넣어도 되는 이유.** 다른 사이트의 페이지는 같은 출처 정책 때문에 우리 응답을 읽지 못한다. DNS 리바인딩으로 출처를 흉내 내면 Host 헤더가 그 사이트 이름이 되어 403을 받는다. 그래서 토큰이 든 `index.html`을 읽을 수 있는 것은 `127.0.0.1:<포트>`나 `localhost:<포트>`로 연 우리 페이지뿐이다. 이 PC의 프로그램은 어차피 `server.json`을 읽을 수 있다. 쿼리의 토큰이 새지 않게 모든 응답에 `Referrer-Policy: no-referrer`를 붙인다.
- **DNS 리바인딩과 CSRF.**
  - 모든 요청: Host가 정확히 `127.0.0.1:<포트>` 또는 `localhost:<포트>`가 아니면 403이다.
  - 모든 요청: Origin이 있으면 우리 출처이거나 `allowedOrigins` 옵션(기본 비어 있음, VS Code 웹뷰용)에 있어야 한다. 아니면 403이다.
  - `POST /event`는 `Content-Type: application/json`만 받는다. 다른 형식은 **415**다(400은 내용이 틀린 경우에만 쓴다). 이 형식은 브라우저가 CORS 사전 요청을 먼저 보내게 만드는데, `OPTIONS`는 405로 답하고 CORS 허용 헤더는 어디에도 보내지 않는다. 그래서 다른 사이트는 이벤트를 보낼 수 없다.
  - 본문은 16 KiB까지다. 넘으면 413이다. 확인 순서는 Host, Origin, 토큰(401), 형식(415), 크기(413), 내용(400)이다.
- **최소 데이터.** `agent`(codex, claude), `type`(8가지), `sessionId`(1~200자), `cwd`(1~1024자), `ts`(숫자), 선택 `detail`(40자 이하)만 꺼내고 나머지 필드는 버린다. 프롬프트, 명령, 도구 출력은 상태에도, WebSocket에도, 로그에도 들어가지 않는다. 제어 문자가 든 문자열은 400이다. 로그에는 개수와 오류만 남긴다(예: 종료할 때 `이벤트 4개 받음, 0개 거부`).
- **시각(`ts`).** 숫자인지는 검사하지만 서버가 받은 순간의 자기 시계로 바꾼다. tick도 서버 시계로 흐르므로 두 시계가 섞이지 않는다. 그리고 미래 시각을 보내 `now`를 앞으로 밀어 상태를 멈추게 하는 일도 막는다.
- **tick과 시간 설정.** 타이머가 약 1초(`tickMs`)마다 `tick`을 넣는다. `holdMs` 등은 `timing` 옵션으로 바꿀 수 있어 테스트는 짧은 값을 쓴다. 상태가 바뀔 때만 보낸다.
- **종료.** Ctrl+C(SIGINT), SIGTERM, SIGHUP, SIGBREAK에 WebSocket 클라이언트에 1001(going away)로 닫기를 보내고(0.5초 뒤 남은 연결은 끊는다), 타이머를 멈추고, `server.json`을 지우고, 소켓을 닫는다.
- **정적 파일.** 경로를 한 번 디코딩한 뒤 영문, 숫자, `.`, `_`, `-`, `/`만 허용하고 `.`으로 시작하는 조각(`..`, 숨김 파일)을 거부한다. 그 뒤에도 실제 경로가 화면 폴더 안인지 다시 확인한다. 어긋나면 모두 404다.
- **페이지 연결.** `?demo`가 없으면 meta의 토큰으로 브라우저 내장 `WebSocket`(`ws://<location.host>/ws?token=...`)을 연다. 연결이 닫히면 1초부터 두 배씩, 최대 30초 기다렸다가 다시 연다(`packages/ui/src/backoff.ts`). 메시지를 하나 제대로 받으면 대기 시간을 처음으로 돌린다. 연결이 없는 동안에는 "연결 안 됨" 띠를 그린다. `?demo`는 서버 없이 그대로 돈다.
- **simulate.** `pixel-office simulate [--loops N] [--speed X]`는 `server.json`을 읽고 `/health`를 확인한 뒤 데모 대본의 이벤트를 데모와 같은 간격으로 보낸다. 서버가 없으면 `pixel-office start`를 먼저 하라고 말하고 1로 끝난다. `--speed`는 테스트용 배속이다.
- **확인한 것.** 이 PC(Windows 11, Node 24)에서 `start`, `/health`, `simulate --loops 1`, `ws` 클라이언트로 받은 장면(IDLE, CODEX_BUILDING, CLAUDE_RUNNING, CLAUDE_ALERT, CODEX_BUILDING, SUCCESS, IDLE 순서), Origin 없음과 다른 Origin의 403, 틀린 토큰의 401, 콘솔 Ctrl+C 뒤 `server.json` 삭제를 확인했다. 브라우저 화면과 Orca 내장 브라우저의 WebSocket 연결은 아직 확인하지 않았다.

### 3단계 화면 확인 (Orca 1.4.253 내장 브라우저)

- 실제 서버(`pixel-office start`)의 화면을 열고 `simulate`를 보내자 WebSocket으로 장면이 바뀌었다(`docs/screenshots/step3-live-alert.png`).
- 서버를 끄면 "연결 안 됨" 배너가 뜬다(`step3-disconnected.png`).
- 서버를 다시 켜면 토큰이 새로 만들어진다. 처음에는 열려 있던 화면이 예전 토큰을 계속 써서 다시 연결하지 못했다. 그래서 화면이 다시 연결하기 전에 같은 서버의 `index.html`을 새로 받아 현재 토큰을 읽도록 고쳤다(`packages/ui/src/token.ts`). 고친 뒤 재시작 후 다시 연결되어 상태를 받는 것을 확인했다.

## 7. Claude Code 훅 (4단계)

공식 문서 https://code.claude.com/docs/en/hooks 를 2026-11-09에 읽고 그 내용에 맞췄다. 아래에서 "문서"는 그 문서에서 확인한 것이고 "추정"은 우리가 짐작으로 정한 것이다. 실제 Claude Code 세션에서 확인하는 일은 사용자가 `init`을 승인한 뒤에 한다.

### 7.1 대응표 (`packages/core/src/claude.ts`, 순수 함수 `fromClaudeHook`)

| Claude Code 훅 | 사무실 이벤트 | detail |
|---|---|---|
| `UserPromptSubmit` | `start` | 없음. 프롬프트는 보내지 않는다 |
| `PreToolUse` | `tool_start` | 도구 이름(`Bash`, `Edit` 등). 40자에서 자른다 |
| `PostToolUse` | `tool_end` | 도구 이름 |
| `PostToolUse` 중 도구가 `Bash`나 `PowerShell`이고 명령이 테스트 실행으로 보이는 것 | `success` | `test` (추정, 7.2) |
| `PostToolUseFailure` | `error` | `Bash`와 `PowerShell`은 `error` 첫 줄 `Exit code N`에서 읽은 `exit N`. 그 줄이 없거나 다른 도구면 도구 이름 |
| `Notification` 중 `permission_prompt`, `agent_needs_input`, `elicitation_dialog`, `elicitation_url_dialog` | `waiting` | 없음 |
| 그 밖의 `Notification`(`idle_prompt`, `auth_success`, `agent_completed`, `quota_*` 등) | 보내지 않음 | |
| `Stop` | `stop` | 없음 |
| `StopFailure` | `error` | API 오류 종류(`rate_limit` 등) |
| 그 밖의 모든 훅(`SessionStart`, `SessionEnd`, `SubagentStop` 등) | 보내지 않음 | |

- `sessionId`는 `session_id`, `cwd`는 `cwd`, `agent`는 `claude`다. `ts`에는 지금 시각을 넣지만 서버가 자기 시계로 바꾼다(6절).
- `session_id`나 `cwd`가 없거나, 너무 길거나(200자, 1024자), 제어 문자가 들어 있으면 아무것도 보내지 않는다. 서버가 어차피 거부할 이벤트이기 때문이다.
- 문서에서 확인한 것:
  - 공통 필드 `session_id`, `cwd`, `hook_event_name`.
  - `PreToolUse`와 `PostToolUse`의 `tool_name`, `tool_input`.
  - `PostToolUse`는 도구가 **성공했을 때만** 온다.
  - `PostToolUseFailure`의 `error`는 Bash와 PowerShell에서 첫 줄이 `Exit code N`이다. 셸을 시작하지도 못했을 때는 그 줄이 없다.
  - `Notification`의 `notification_type` 값 목록과 각 값의 뜻.
  - `StopFailure`의 `error`는 오류 종류(`rate_limit`, `overloaded` 등)다.
- `waiting`을 그 네 가지로 정한 이유: 문서의 설명을 보면 사람이 답하기 전에는 일이 진행되지 않는 것들이다(도구 권한, 백그라운드 세션이나 팀원의 입력 대기, MCP 입력 양식, MCP가 연 URL). `idle_prompt`는 "Claude가 60초 전에 답을 끝냈는데 사용자가 아직 입력하지 않았다"는 뜻이라 기다림이 아니라 쉬는 상태다.
- Windows에 Git Bash가 없으면 Claude Code는 `Bash` 대신 `PowerShell` 도구를 쓴다(문서). 그래서 `PowerShell`도 셸 도구로 함께 다룬다.

### 7.2 추정인 것

- **테스트 명령 판정.** `PostToolUse`에는 종료 코드가 없다. 하지만 성공했을 때만 오므로, 명령이 테스트 실행처럼 보이면 "테스트 통과"(`success`, `test`)로 본다.
  - 명령을 `;`, `&&`, `||`, `|`, 줄바꿈으로 나눈다.
  - 앞의 `VAR=값`과 감싸는 명령을 벗긴다: `env`, `sudo`, `time`, `npx`, `bunx`, `pnpx`, `uv run`, `poetry run`, `pdm run`, `pnpm exec`, `pnpm dlx`, `yarn exec`, `yarn dlx`, `npm exec`, `python -m`, `python3 -m`, `py -m`.
  - 남은 것이 다음 중 하나면 테스트로 본다.
    - `pytest`, `py.test` (`python -m pytest`, `uv run pytest` 포함)
    - `npm test`, `npm t`, `pnpm test`, `yarn test`, `bun test`, `npm run test`, `npm run test:이름`, `yarn test:이름`, `pnpm test:이름`
    - `vitest`, `jest` (`npx vitest`, `pnpm vitest` 등 포함)
    - `go test`, `cargo test`
    - `node ... --test`
    - `mvn ... test`, `./mvnw test`, `gradle ... test`, `./gradlew :모듈:test`
- 이 판정은 틀릴 수 있다. 다른 이름의 스크립트로 테스트를 돌리면 놓치고, `test` 스크립트가 다른 일을 해도 테스트로 본다. `npm test | tail`처럼 파이프를 쓰면 성공 여부는 마지막 명령의 것이다.
- 명령 글자는 훅 안에서만 읽고 보내지 않는다. 서버로 가는 것은 `test`라는 이름표뿐이다.
- `waiting`으로 보는 알림 종류도 문서 설명을 읽고 우리가 고른 것이다.

### 7.3 훅 실행기 (`packages/cli/src/hook.ts`)

- `node <절대 경로>/hook.js claude`로 실행된다. 하는 일은 다음과 같다.
  1. stdin을 1 MiB까지 읽는다. 넘으면 포기한다.
  2. `fromClaudeHook`로 이벤트를 만든다.
  3. `PIXEL_OFFICE_HOME` 또는 `~/.pixel-office`의 `server.json`을 읽는다.
  4. `http://127.0.0.1:<포트>/event`에 토큰 헤더와 `Content-Type: application/json`을 붙여 보낸다.
- 전체 시간 제한은 500ms다. `AbortController`와 `unref()`한 타이머로 요청을 끊고 끝낸다.
- **종료 코드는 언제나 0이고 stdout과 stderr는 언제나 비어 있다.** 서버가 없거나, `server.json`이 깨졌거나, 요청이 거부되거나, stdin이 엉망이거나, 시간이 넘어도 조용히 끝난다. 경고와 예기치 않은 예외도 삼킨다. core 모듈은 동적 import로 불러서 설치가 깨져 있어도 아무것도 출력하지 않는다.
- **stdout을 비우는 이유.** 문서에 따르면 `UserPromptSubmit`, `SessionStart` 등에서는 훅의 stdout이 Claude가 읽는 맥락에 들어간다. 우리 훅이 무언가를 출력하면 Claude의 대화에 끼어든다. 0이 아닌 종료 코드는 훅 오류로 보이고, 2는 일부 이벤트에서 동작을 막는다. 그래서 출력도 오류도 내지 않는다.
- 빨리 뜨도록 `ws`를 포함한 서버 코드는 불러오지 않는다. `@pixel-office/core/home`(Node 기본 모듈만 씀)과 브라우저용 core만 쓴다. 이 PC에서 서버가 없을 때 약 70ms, 응답하지 않는 서버에서는 약 580ms(500ms 제한 포함) 걸렸다.
- `PIXEL_OFFICE_DEBUG=1`이면 `<home>/hook-debug.log`에 한 줄씩 남긴다(훅 이름, 만든 이벤트 종류, 결과). 페이로드 내용은 남기지 않는다. 이때도 stdout과 stderr에는 쓰지 않는다.

### 7.4 async와 timeout

- 문서에서 확인한 것: command 훅에 `"async": true`를 주면 백그라운드에서 돌고 Claude는 기다리지 않는다. `timeout`은 초 단위이고 기본값은 600초인데, async 훅에는 적용되지 않는다.
- 우리 항목은 `"async": true`, `"timeout": 3`이다. async 덕분에 에이전트가 느려지지 않는다. timeout은 async를 모르는 Claude Code에서만 의미가 있고, 훅이 500ms 안에 스스로 끝나므로 닿을 일이 없다.
- async의 대가: 훅들이 동시에 돌아서 이벤트가 서버에 도착하는 순서가 바뀔 수 있다. 빠른 도구의 `tool_start`와 `tool_end`가 뒤바뀌어도 둘 다 working이라 화면은 같다. `Stop`은 Claude가 답을 다 쓴 뒤에 오므로 앞선 도구 이벤트보다 먼저 도착할 일은 드물다(추정).
- 비대화 모드(`claude -p`)에서는 세션이 끝날 때 남은 async 훅을 끝낸다(문서). 마지막 이벤트가 빠질 수 있다.

### 7.5 `pixel-office init` / `uninit`

- 대상은 Claude Code 사용자 설정 `~/.claude/settings.json`이다. 문서에 따르면 `CLAUDE_CONFIG_DIR`이 설정 폴더를 옮기므로, 그 값이 있으면 `$CLAUDE_CONFIG_DIR/settings.json`을 고친다. Windows에서 `~`는 `%USERPROFILE%`이다.
- 7.1의 이벤트 7개(`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `Stop`, `StopFailure`)마다 `hooks.<이벤트>`에 matcher 없는(모두 받는) 그룹 하나를 덧붙인다.
- **실행 형태는 exec form이다.**
  - `command`에는 `process.execPath`(init을 실행한 node의 절대 경로)를, `args`에는 `[hook.js의 절대 경로, "claude"]`를 쓴다.
  - 문서에 따르면 `args`가 있으면 Claude Code는 셸 없이 프로그램을 바로 실행한다.
  - 셸 형태(`args` 없음)는 macOS와 Linux에서 `sh -c`, Windows에서 Git Bash, Git Bash가 없으면 PowerShell로 돈다. 셸마다 따옴표 규칙이 다르고, PowerShell은 따옴표로 시작하는 명령을 실행하지 않고 문자열로 출력한다(문서의 "PowerShell started no program").
  - exec form에는 셸이 없으므로 `C:\Program Files\nodejs\node.exe`처럼 공백이 있는 경로도 따옴표 없이 그대로 쓰면 되고, Git Bash가 있든 없든 똑같이 돈다. 문서는 Windows에서 `command`가 `node.exe` 같은 진짜 실행 파일이어야 한다고 하는데 `process.execPath`가 그렇다.
- **우리 항목 표시.** 따로 표시 필드를 두지 않고 인자로 알아본다. `args` 안에 경로가 `cli/dist/src/hook.js`로 끝나는 요소가 있고(구분자 `\`, `/` 모두) 바로 다음 요소가 `claude`면 우리 것이다. 누가 셸 형태로 고쳐 놓았을 때를 위해 `command` 문자열에 `cli/dist/src/hook.js claude`가 있어도 우리 것으로 본다. 다른 훅(Orca, skill kit 등)은 건드리지 않는다.
- **병합 규칙.**
  - 다른 키와 그 순서, 다른 훅을 모두 그대로 둔다. 원래 파일의 들여쓰기(기본 2칸), 줄바꿈(LF, CRLF), 마지막 줄바꿈, BOM을 따른다.
  - 이미 같은 항목이 있으면 아무것도 바꾸지 않는다. 그래서 두 번 실행해도 결과가 같다.
  - 저장소를 옮겼거나 다른 node로 실행해서 예전 항목이 있으면, 첫 예전 항목 자리에 새 항목을 넣고 나머지 예전 항목은 지운다.
  - 설정 파일이 없으면 우리 훅만 담아 새로 만든다.
  - JSON이 아니거나, 맨 바깥이 객체가 아니거나, `hooks`나 이벤트 값의 모양이 다르면 이유를 말하고 아무것도 바꾸지 않는다(종료 코드 1).
- **흐름.**
  1. 바뀌기 전과 후를 unified diff로 보여 준다. diff는 직접 만든 작은 줄 비교이고 의존성이 없다.
  2. `--dry-run`이면 여기서 끝난다.
  3. `--yes`가 없으면 터미널에서 "적용할까요? (y/N)"를 묻는다. 터미널이 아니면(파이프 등) 종료 코드 64로 끝나고 아무것도 쓰지 않는다.
  4. 원래 파일을 `<pixel-office home>/backups/<시각>/claude-settings.json`에 바이트 그대로 복사한다. 시각은 `2026-11-09T01-02-03-456Z`처럼 콜론이 없는 UTC다.
  5. 같은 폴더의 임시 파일에 쓰고 이름을 바꿔 원자적으로 덮어쓴다. 묻는 동안 파일이 바뀌었으면 쓰지 않는다.
  6. 백업 경로를 출력한다.
- **uninit**은 우리 항목만 지운다. 우리 항목을 지워서 비게 된 그룹, 이벤트 배열, `hooks` 객체만 지우고, 원래부터 비어 있던 것은 둔다. 그래서 init 뒤에 uninit을 하면 원래 파일과 바이트까지 같다(원래 파일이 위의 형식 규칙을 따를 때).
  - 예외: 원래 `"hooks": {}`나 빈 이벤트 배열이 있었다면, init이 그 안을 채우고 uninit이 다시 비우면서 그 빈 껍데기까지 지운다.
  - 백업은 init과 같은 방식으로 남긴다.
- node나 저장소 위치가 바뀌면 `init`을 다시 실행해야 한다(예: nvm으로 node 버전을 바꾼 경우).

### 7.6 WSL

- 사용자는 두 PC 모두 WSL **mirrored networking**을 쓰기로 했다. 이 모드에서는 WSL과 Windows가 `127.0.0.1`을 함께 쓰므로, WSL 안의 Claude Code 훅이 Windows에서 도는 Pixel Office 서버에 바로 닿는다. `.wslconfig` 변경은 사용자의 승인을 받아 따로 한다.
- 남는 문제는 `server.json`의 위치다. 서버는 Windows의 `%USERPROFILE%\.pixel-office`에 쓰는데, WSL의 `~`는 리눅스 홈이다. 그래서 WSL 안에서 `init`을 하면 훅이 `PIXEL_OFFICE_HOME=/mnt/c/Users/<이름>/.pixel-office`를 갖고 실행되게 한다. exec form에는 셸이 없으므로 `command`를 `/usr/bin/env`로 하고 `args`를 `["PIXEL_OFFICE_HOME=...", node 경로, hook.js 경로, "claude"]`로 쓴다.
- WSL 판정: `WSL_DISTRO_NAME`이 있거나 `/proc/version`에 `microsoft`가 들어 있으면 WSL이다.
- Windows 사용자 폴더는 `cmd.exe /c echo %USERPROFILE%`의 결과를 `wslpath -u`로 바꿔 찾는다. `--windows-home <경로>`로 직접 줄 수도 있다(`/mnt/c/Users/이름` 또는 `C:\Users\이름`). 찾지 못하면 `--windows-home`을 쓰라는 메시지를 내고 실패하며 아무것도 쓰지 않는다. 테스트는 판정과 폴더 찾기를 가짜 함수로 바꿔 끼운다.
- 백업은 WSL 쪽 `~/.pixel-office/backups`에 남는다. 고치는 설정 파일이 WSL 쪽에 있기 때문이다.

### 7.7 실제 세션 확인 (2026-11-09, Claude Code 2.1.319, Windows)

- 실제 `~/.claude/settings.json`에 `init`을 적용하고, 서버와 Orca 브라우저를 켠 채 임시 폴더에서 `claude -p --model haiku`를 돌렸다. WebSocket으로 받은 장면 변화를 시각과 함께 기록했다.
- 결과: 작업 중 → (셸 명령 `exit 3`) 문제 발생 → 작업 중 → (응답 완료) 완료. 완료는 약 3.8초 뒤 다음 장면으로 바뀌었다(holdMs 4초).
- 따라서 이 버전은 `args`(exec form)와 `async`를 지원한다. 셸 형태로 바꿀 필요가 없다.
- 이미 실행 중인 세션도 설정 변경을 바로 반영했다(이 확인을 하던 세션 자신이 이벤트를 보내기 시작했다).
- 여러 Claude 세션이 책상 하나를 함께 쓴다. 한 세션이 끝나도 다른 세션이 일하고 있으면 "작업 중"으로 돌아간다. 설계대로이며, 세션 구분은 6단계에서 다룬다.
- 캡처: `screenshots/step4-real-working.png`, `screenshots/step4-real-success.png`.

### 7.8 확인하지 못한 것

- "응답 대기" 장면. 비대화 모드에서는 권한 요청이 생기지 않았다.
- "문제 발생" 장면의 실제 세션 캡처. 서버 기록으로는 확인했고, 그림은 3단계에서 확인했다.
- async 훅의 순서 바뀜이 화면에 드러나는지.
- 실제 WSL에서 `cmd.exe`와 `wslpath`로 폴더를 찾는 부분. 이 PC에서는 돌려 보지 않았고, 테스트는 가짜 함수를 쓴다.

## 8. Codex 훅 (5단계)

codex-cli 0.167.0 기준. "문서"는 Codex hooks 문서(developers.openai.com/codex/hooks, 2026-11-09 현재 learn.chatgpt.com/docs/hooks로 이동), "소스"는 openai/codex `main`의 `codex-rs`다. 설치된 0.167.0 바이너리에 `PostModelRequest`, `PermissionRequest`, `commandWindows`, `dangerously-bypass-hook-trust` 문자열이 들어 있는 것은 확인했다.

### 8.1 Claude Code와 다른 점

- **설정 파일:** `~/.codex/hooks.json`(`CODEX_HOME`이 있으면 그 폴더)이다. 모양은 Claude Code와 같다(`hooks.<Event>[]` 그룹, 그 안의 `hooks[]` 핸들러). `config.toml`의 `[hooks]` 표와 함께 있으면 Codex가 합치므로, 우리는 `hooks.json`만 고친다.
- **신뢰가 필요하다(문서):** 사용자 훅은 Codex의 `/hooks`에서 신뢰해야 실행된다. 신뢰는 훅의 해시에 묶이므로, 명령이 바뀌면(저장소 이동, node 변경) 다시 신뢰해야 한다. `init`은 적용 뒤 이를 안내한다.
- **exec form이 없다(문서, 소스):** `command`는 문자열 하나이고 셸이 실행한다. Windows에서는 `%COMSPEC% /C "<command>"`(바깥 따옴표를 붙여 그대로 넘김), 그 밖에서는 `$SHELL -lc <command>`다(`codex-rs/hooks/src/engine/command_runner.rs`).
- **종료 코드가 없다(소스):** 셸 도구의 `tool_name`은 `Bash`이고, `PostToolUse`의 `tool_response`는 출력 문자열뿐이다(`unified_exec_tests.rs`). `PostToolUseFailure`도 없다. 그래서 Codex는 도구 실패를 알 수 없고, "테스트 통과" 추정도 하지 않는다.
- **stdout(문서):** `UserPromptSubmit`과 `SessionStart`의 평문 stdout은 모델 컨텍스트에 들어가고, `Stop`의 평문은 잘못된 출력이다. 종료 코드 2는 동작을 막는다. 우리 훅은 아무것도 출력하지 않고 항상 0으로 끝나므로 해당 없다.
- **async(문서):** `"async": true`면 백그라운드에서 돈다(세션당 8개까지). 실제 세션에서 동작이 확인된 것은 동기 훅뿐이라 Codex 훅은 동기로 둔다(8.6).

### 8.2 대응표 (`packages/core/src/codex.ts`, 순수 함수 `fromCodexHook`)

| Codex 이벤트 | 사무실 이벤트 | detail |
|---|---|---|
| `UserPromptSubmit` | start | 없음 (프롬프트는 버림) |
| `PreToolUse` | tool_start | 도구 이름 |
| `PostToolUse` | tool_end | 도구 이름 (출력은 버림) |
| `PermissionRequest` | waiting | 도구 이름 |
| `PostModelRequest` (`status: "failed"`만) | error | `model` (오류 문구는 버림) |
| `Stop` | stop | 없음 (마지막 메시지는 버림) |

- 등록하지 않는 것: `SessionStart`(아직 일을 시작하지 않음), `SessionEnd`(항상 동기로 돌아 세션 종료를 늦춤), `Interrupt`(사용자가 멈춘 것을 "완료"로 그리면 틀리다. 30초 뒤 쉬는 중으로 돌아간다), 압축·하위 에이전트 이벤트.
- `PostModelRequest`는 모델 요청마다 오므로 훅이 그만큼 더 실행된다. 동기 훅이라 요청마다 훅 실행 시간(보통 수십 ms, 최대 0.5초)만큼 Codex가 기다린다.

### 8.3 명령 문자열 (`packages/cli/src/settings.ts`, `codexCommand`)

- Windows: 훅 명령은 래퍼 파일 경로 하나다(`C:/Users/<이름>/.pixel-office/pixel-office-codex-hook.cmd`, `/`로 쓰고 공백 없음). 실제 Codex가 훅을 PowerShell로 실행했고(8.6), PowerShell은 따옴표로 시작하는 줄을 문자열로 읽기 때문이다. 따옴표 없는 경로 하나는 cmd, PowerShell, Git Bash 모두 같은 방식으로 실행한다(Orca의 Codex 훅도 이 방식). 래퍼 안에서 node와 hook.js를 큰따옴표로 감싸 실행하고(`@echo off`, 항상 `exit /b 0`), 래퍼 경로에 공백이나 특수 문자가 있으면 `init`이 거부하고 `PIXEL_OFFICE_HOME`을 바꾸라고 안내한다. 래퍼 안에서는 `%`가 변수로 펼쳐지므로 node나 hook.js 경로에 `%`나 `"`가 있어도 거부한다. 저장소를 옮기면 래퍼만 바뀌고 훅 명령은 그대로라 다시 신뢰할 필요가 없다.
- 그 밖(Linux, WSL): `'<node>' '<hook.js>' codex`. 작은따옴표는 sh, bash, zsh, fish에서 모두 문자 그대로다. 경로 안의 `'`는 `'\''`로 쓴다. WSL에서는 앞에 `/usr/bin/env 'PIXEL_OFFICE_HOME=/mnt/c/...'`를 붙인다(셸의 `VAR=값` 문법에 기대지 않음).
- 우리 항목 표시: 명령 문자열에 `cli/dist/src/hook.js` 다음 `codex`가 오면 우리 것이다. Claude 항목(`claude`)과 서로 건드리지 않는다.
- 테스트: 공백과 `'`가 든 경로로 만든 명령을 Codex와 같은 방식(Windows `cmd.exe /C "..."`, 그 밖 `/bin/sh -lc`)으로 실제 실행해 인자가 `codex` 하나로 전달되는지 확인한다.

### 8.4 `init` / `uninit`

- `--agent claude|codex|both`(기본 both). 파일마다 diff, 확인, 백업, 쓰기를 따로 한다. 한 번 실행의 백업은 한 폴더(`backups/<시각>/claude-settings.json`, `codex-hooks.json`)에 모인다.
- both에서 Codex 폴더가 없으면 Codex는 건너뛴다. `--agent codex`는 파일을 새로 만든다.
- 실제 `~/.codex/hooks.json`에 `--dry-run`을 돌린 결과: 기존 5개 이벤트(UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop)의 Orca 그룹 뒤에 우리 그룹을 덧붙이고, `PostModelRequest`만 새로 생긴다. 지워지는 줄은 없고 파일 수정 시각도 그대로였다.

### 8.5 확인하지 못한 것

- async로 되돌려도 되는지(PowerShell 실패가 원인이었으므로 될 가능성이 있다).
- Orca 안의 Codex에서 래퍼 방식이 도는지. Orca는 앱을 시작할 때만 `~/.codex/hooks.json`을 계정 폴더로 복사해서, 이번 확인은 `CODEX_HOME`을 지운 같은 터미널에서 했다.
- `PermissionRequest`가 승인 창마다 오는지, 자동 승인 모드에서는 오지 않는지.
- `PostModelRequest`의 `failed`가 재시도 중인 일시 오류에도 오는지. 그렇다면 잠깐 "문제 발생"이 보였다가 다음 이벤트로 돌아간다.

### 8.6 실제 세션 확인 1차 (2026-11-09, codex-cli 0.167.0, Windows, Orca 터미널)

- **Orca 안의 Codex는 다른 `CODEX_HOME`을 쓴다.** `%APPDATA%\orca\codex-accounts\<id>\home`이다. Orca가 `~/.codex/hooks.json`을 이 폴더로 복사해서, `init`이 넣은 훅이 그대로 나타났다. 신뢰 기록은 그 폴더의 `config.toml`(`[hooks.state]`)에 남는다.
- **신뢰:** Codex 시작 화면에 "Hooks need review"가 떴고, `/hooks`에서 우리 훅 6개를 신뢰했다. 화면에는 Async, 3s로 표시됐다.
- **1차: 이벤트가 오지 않았다.** 작업 하나를 끝까지 돌리는 동안 서버에 Codex 이벤트가 하나도 오지 않았고, `PIXEL_OFFICE_DEBUG=1`의 로그 파일도 생기지 않았다. 같은 파일의 Orca 훅(동기)은 실행됐다. 같은 명령을 `cmd.exe /C "..."`로 직접 실행하면 서버가 받았다(204).
- **2차: 원인은 셸이었다.** async를 빼고 다시 신뢰하자 Codex 화면에 "Hook failed, exited with code 1"과 PowerShell 구문 오류(`UnexpectedToken`, `"…node.exe" "…hook.js" codex`)가 보였다. 즉 이 버전은 훅을 PowerShell로 실행한다(소스의 `cmd.exe` 기본값과 다름). 1차에서 이벤트가 없던 것도 같은 실패가 async라서 화면에 안 보였던 것으로 본다. "async가 실행되지 않는다"는 1차의 추정은 틀렸다.
- **수정:** Windows 훅 명령을 래퍼 경로 하나로 바꿨다(8.3). 테스트는 래퍼를 `cmd.exe /C "..."`와 `powershell.exe -Command`로 실제 실행해 인자와 stdin이 그대로 전달되고 출력이 없는지 확인한다.
- **3차: 동작 확인.** 래퍼 방식을 적용하고(`~/.codex/hooks.json`), Orca 터미널에서 `CODEX_HOME`을 지운 채 Codex를 열어 바뀐 훅 6개를 신뢰했다. 짧은 작업 하나에 Codex 책상이 작업 중 → 완료 → 약 4초 뒤 쉬는 중으로 바뀌었고, "Hook failed"는 없었다. 캡처: `screenshots/step5-codex-working.png`, `screenshots/step5-codex-success.png`.
- **Orca 계정 폴더는 앱 시작 때만 갱신된다.** `init` 뒤에도 Orca 안의 Codex는 예전 훅을 쓰다가, Orca를 다시 시작한 뒤에 새 훅을 받았다. 그래서 `init` 뒤에는 Orca를 다시 시작하고, Orca 안의 Codex에서도 `/hooks`로 신뢰해야 한다.

## 9. 작업 환경 단위 사무실 (6단계)

### 9.1 요구

사용자 결정(2026-11-09): 사무실은 에이전트별 전체 합산이 아니라 **작업 환경 하나**를 보여 준다. Orca worktree나 VS Code 워크스페이스 폴더 하나에서 Codex와 Claude를 함께 쓰므로, 그 폴더의 화면에는 그 폴더에서 일하는 두 에이전트만 나온다. 이전에는 모든 세션을 합쳐서, 다른 폴더의 Claude 세션이 같은 책상을 덮어썼다(7.7, 8.6에서 관찰).

### 9.2 설계 (`packages/core/src/workspace.ts`)

- **기준:** 작업 폴더(루트)다. 세션의 `cwd`가 루트 자신이거나 그 안이면 그 사무실에 속한다. 하위 폴더에서 에이전트를 실행해도 같은 사무실이고, 이름이 비슷한 형제 폴더(`repo-old`)는 다른 사무실이다.
- **경로 정규화(`normalizePath`):** 같은 폴더의 여러 표기를 하나로 만든다.
  - `\`를 `/`로 바꾸고, 겹친 `/`와 끝의 `/`를 정리한다.
  - WSL 마운트 `/mnt/c/...`는 `c:/...`로 바꾼다.
  - Windows에서 본 WSL(`\\wsl.localhost\<배포판>\...`, `\\wsl$\...`)은 Linux 경로 `/...`로 바꾼다.
  - 드라이브 경로는 전부 소문자로 바꾸고(Windows는 대소문자 무시), Linux 경로는 그대로 둔다.
- **서버:** 서버는 하나다. WebSocket `/ws?token=..&workspace=<폴더>`로 연결한 화면은 그 폴더의 세션만으로 계산한 장면과 세션 목록을 받는다. `workspace`가 없으면 예전처럼 전부 받는다.
  - 상태가 바뀌면 요청된 폴더마다 한 번씩 계산하고, 내용이 바뀐 화면에만 보낸다. 다른 폴더의 이벤트는 그 화면에 아무것도 보내지 않는다.
  - `workspace`가 비었거나 1024자를 넘거나 제어 문자가 있으면 400으로 거절한다.
- **화면:** 주소 `/?workspace=<폴더>`를 읽어 WebSocket에 넘기고, 탭 제목을 `Pixel Office · <폴더 이름>`으로 바꾼다.
- **주소 만들기:** `pixel-office url [폴더]`(기본은 현재 폴더)가 실행 중인 서버의 포트로 주소를 출력한다. 주소에는 매개변수가 하나뿐이다. Orca CLI가 cmd.exe를 거쳐서 `&`에서 주소가 잘리기 때문이다. `/`와 `:`는 읽기 쉽게 그대로 두고, 공백, `&`, `#` 같은 문자만 인코딩한다.

### 9.3 실제 확인 (2026-11-09, Orca 1.4.253, Windows)

- Orca 내장 브라우저에 탭 두 개를 열었다. 하나는 Codex가 일하는 임시 폴더(`.../scratchpad/po-codex`), 다른 하나는 이 확인을 하던 Claude 세션의 폴더(`D:\aaa\skill_kit_kch`)다.
- Codex에게 10초짜리 명령을 시키는 동안 같은 시각에 두 탭을 캡처했다.
  - Codex 폴더 탭: Codex 작업 중, Claude 쉬는 중
  - Claude 폴더 탭: Codex 쉬는 중, Claude 작업 중
- 캡처: `screenshots/step6-workspace-codex-folder.png`, `screenshots/step6-workspace-claude-folder.png`.

### 9.4 확인하지 못한 것

- WSL 안에서 실행한 에이전트(`/mnt/...`, `/home/...`)가 Windows에서 연 사무실과 맞는지. 테스트는 정규화 함수로만 했다.
- 같은 폴더에서 같은 에이전트 세션이 두 개일 때의 표시. 지금은 더 급한 상태(문제 발생 > 응답 대기 > 작업 중 > 완료)를 책상에 그린다.
- (해결) VS Code는 10절의 확장이, Orca는 11절의 훅이 사무실을 자동으로 연다.

## 10. VS Code 확장 (7단계, `packages/vscode`)

### 10.1 동작

- VS Code 창이 폴더를 연 채로 시작하면(`onStartupFinished`) 첫 작업 폴더의 사무실을 편집기 옆 탭에 연다. 포커스는 편집기에 남는다. 설정 `pixelOffice.autoOpen`(기본 켜짐)으로 끌 수 있다.
- 명령 "Pixel Office: 사무실 열기"로 다시 연다. 작업 폴더가 여럿이면 고르게 한다. 같은 폴더의 탭이 이미 있으면 그 탭을 앞으로 가져온다.
- 탭 제목은 `Pixel Office · <폴더 이름>`이다.

### 10.2 설계

- **같은 UI 번들:** 웹뷰는 사무실을 직접 그리지 않는다. 웹뷰 안에 iframe 하나를 두고, 로컬 서버가 주는 `/?workspace=<폴더>` 페이지를 띄운다. Orca 브라우저와 같은 페이지이고, iframe 안 페이지의 Origin이 서버 자신의 것이라 서버의 Origin 검사(6절)를 바꿀 필요가 없다. 토큰은 그 페이지가 서버의 HTML에서 읽으므로 웹뷰 HTML에는 비밀이 없다.
- 웹뷰 페이지의 CSP는 `default-src 'none'; frame-src <서버 origin>; style-src 'unsafe-inline'`이다. 웹뷰 자체에는 스크립트가 없다. `enableScripts`는 켠다. 끄면 VS Code가 iframe에 거는 sandbox가 안쪽 페이지의 스크립트까지 막는다.
- 주소는 `vscode.env.asExternalUri`를 거친다. 원격 창에서 포트 전달이 필요할 때를 위한 것이다.
- 숨겨진 탭은 버리고(`retainContextWhenHidden: false`), 다시 보일 때 서버를 확인하고 새로 그린다. 숨긴 동안 CPU를 쓰지 않는다.
- **서버 시작:** `server.json`의 포트로 `/health`를 확인하고, 답이 없으면 CLI의 `start`를 띄운다. 별도 Node 설치를 요구하지 않도록 VS Code 실행 파일을 `ELECTRON_RUN_AS_NODE=1`로 Node처럼 쓴다. 분리(detached) 실행이라 창을 닫아도 서버는 남는다. 다른 창과 에이전트 훅이 같은 서버를 쓰기 때문이다. 8초 안에 서버가 답하지 않으면 탭에 이유를 한국어로 보여 준다. 두 창이 동시에 시작해도 늦은 쪽은 포트가 이미 쓰여 끝나고, 확인 루프가 먼저 뜬 서버를 찾는다.
- `extensionKind: ["ui"]`: 원격(WSL) 창에서도 확장은 Windows 쪽에서 돈다. 서버와 훅이 있는 쪽이다. 이때 작업 폴더는 원격 경로(`/home/...`)로 넘긴다.
- vscode 모듈에 의존하지 않는 부분(`src/office.ts`)은 Node 테스트로 확인한다: HTML의 CSP와 이스케이프, 실행 중인 서버를 쓰는지, 없으면 시작하고 찾는지, 실패 메시지, 실제 CLI를 분리 실행해 `/health`가 답하는지.

### 10.3 실제 확인 (2026-11-09, VS Code 1.145.2, Windows)

사용자 설정을 건드리지 않도록 임시 `--user-data-dir`, `--extensions-dir`과 `--extensionDevelopmentPath`로 확장 개발 창을 띄웠다.

- 서버가 이미 떠 있을 때: 창이 열리자 `Pixel Office · pixel-office` 탭이 옆에 자동으로 열렸고, 이 저장소에서 일하던 Claude 세션이 "작업 중"으로 나왔다.
- 서버가 없을 때(서버를 끄고 `server.json`은 남긴 상태): 확장이 서버를 띄웠고(`Code.exe`가 Node로 실행), 같은 화면이 나왔다. 개발 창을 닫은 뒤에도 서버는 `/health`에 답했다.
- 캡처: `screenshots/step7-vscode-webview.png`.

### 10.4 확인하지 못한 것

- 원격(WSL, SSH) 창. 경로 넘기기와 `asExternalUri`는 코드만 있다.
- `.vsix` 패키지와 마켓플레이스 배포. 지금 확장은 저장소의 `node_modules`(워크스페이스 링크)에서 core와 cli를 찾으므로 저장소 안에서만 돈다. 패키지로 만들려면 core, ui, cli와 `ws`를 확장 폴더 안에 넣어야 한다.
- (참고) Orca는 VS Code 확장을 싣지 않는다(1절). Orca는 8단계에서 내장 브라우저 탭으로 연다.

## 11. Orca 자동 열기 (8단계)

### 11.1 방식 고르기

- Orca는 VS Code 확장을 싣지 않는다(1절).
- Orca 플러그인 워커는 작업 공간과 에이전트 이벤트를 받는다. 하지만 호스트 API에 브라우저 탭을 여는 기능이 없고(`workspace.open`, `terminal.create`, `editor.open` 등만 있음, Orca 1.4.253 `orca-plugin-authoring` 참고 문서), 플러그인은 네트워크도 막혀 있다.
- 그래서 **에이전트 훅**이 연다. Orca 터미널에는 `ORCA_WORKTREE_ID`(`<repoId>::<worktree 경로>`)가 있다(실제 터미널에서 확인). Orca가 띄운 Claude와 Codex도 Pixel Office 훅을 쓴다. Orca는 앱이 시작할 때 사용자 설정을 자기 프로필(Claude: `CLAUDE_CONFIG_DIR`, Codex: `CODEX_HOME`)로 복사하는데, 두 파일 모두 우리 훅이 들어 있음을 확인했다.

### 11.2 동작 (`packages/cli/src/orca.ts`)

1. 훅이 `start` 이벤트(프롬프트 제출, Claude 세션 시작)를 받았고 `ORCA_WORKTREE_ID`가 있으면 `pixel-office orca-open`을 분리 실행하고 바로 끝난다. 훅은 기다리지 않는다.
2. 같은 worktree는 60초에 한 번만 확인한다(`~/.pixel-office/orca-open.json`). 훅이 실행 직전에 기록하므로 Claude와 Codex 훅이 같은 순간에 돌아도 한 번만 실행된다.
3. `orca-open`은 서버가 답하지 않으면 띄운다(분리 실행). Orca만 쓰는 사용자도 서버를 따로 켤 필요가 없다.
4. `orca tab list --worktree id:<id> --json`으로 그 worktree의 탭을 보고, `/?workspace=<worktree>` 탭이 없을 때만 `orca tab create --url ... --worktree id:<id>`로 만든다. 같은 폴더인지는 `normalizePath`로 비교한다.
5. Orca CLI는 `ORCA_CLI_COMMAND`가 있으면 그것을, Windows에서는 설치된 `orca.exe`를 쓴다. Linux에서는 화면 낭독기와 겹치는 `orca` 대신 `orca-ide`를 쓴다.
- 사용자가 탭을 닫으면 다음 확인(60초 뒤 첫 프롬프트) 때 다시 열린다. `PIXEL_OFFICE_ORCA_OPEN=0`이면 자동 열기를 하지 않는다.
- 터미널에서 `pixel-office orca-open`을 직접 실행해도 된다.

### 11.3 실제 확인 (2026-11-09, Orca 1.4.253, Windows)

- Orca를 다시 시작한 뒤, worktree `C:\Users\00`의 Orca 터미널에서 `claude -p`로 짧은 요청을 보냈다. 훅이 `orca-open`을 실행했고 Orca 브라우저에 `http://127.0.0.1:47821/?workspace=C:/Users/00` 탭(`Pixel Office · 00`)이 생겼다.
- 15초짜리 명령을 시킨 동안 그 탭에서 Claude가 "작업 중"으로 나왔다. 캡처: `screenshots/step8-orca-auto-tab.png`.
- 다시 요청해도 탭은 하나였다. `orca-open`을 직접 실행하면 "이미 열려 있습니다"로 끝났다.
- 테스트: 가짜 Orca CLI로 훅부터 `tab list`, `tab create` 호출까지 확인하는 테스트가 있다. Windows는 `.cmd`, Linux는 셸 스크립트로 돈다.

### 11.4 확인하지 못한 것

- Orca 안의 Codex로 탭이 열리는지. 같은 훅을 쓰지만 Orca의 Codex 계정에서 새 훅을 `/hooks`로 아직 신뢰하지 않았다.
- `tab create`가 포커스를 가져가는지. 이번 확인에서 새 탭은 활성 탭이 되었다. 사용자가 거슬려 하면 다른 방법을 찾아야 한다.
- WSL 안에서 실행한 Orca 터미널(`ORCA_CLI_COMMAND` 경로).
