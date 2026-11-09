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
- **그리기는 순수 함수다.** `art(scene, {frame, reducedMotion, connected})`가 사각형과 글자 목록을 돌려주고, `main.ts`가 그것을 캔버스(처음 160×96, 9b단계부터 240×135 논리 픽셀, 정수 배율)에 칠한다. 외부 이미지 에셋은 없다.
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
- 마켓플레이스 배포. (`.vsix`는 14.3에서 해결)
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

## 12. 픽셀 사무실 (9단계와 9b단계, `packages/ui/src/sprites.ts`, `office.ts`, `pixels.ts`, `sheet.ts`)

9b단계에서 사무실을 중견기업 사무실처럼 다시 그렸다. 동작(장면별 자세, 태그, 라벨, 연결 끊김 배너)은 그대로다.

### 12.1 캔버스와 배경

- 논리 크기를 160×96에서 240×135(16:9)로 키웠다. 화면은 여전히 정수 배율로 키운다.
- 위 240×122가 사무실이고, 아래 13줄이 라벨 줄이다. 라벨 앞에 에이전트 색 네모를 둔다.
- 움직이지 않는 것은 모두 배경 스프라이트 `office` 하나에 한 번 그린다(`office.ts`). 페이지는 이것을 처음에 캔버스로 만들어 두고 프레임마다 `drawImage` 한 번으로 그린다. 그래서 장면 하나의 그리기 목록은 120개 미만이다.
- 배경에 있는 것: 천장 조명 패널, 벽과 징두리 판, 도시가 보이는 큰 창(블라인드, 구름, 빌딩 창문), 책장과 수납장, 벽시계, 정수기, `PIXEL OFFICE` 간판, 순서도와 포스트잇이 붙은 화이트보드, 커피 머신과 프린터가 있는 수납 카운터, 유리벽 회의실(화면 속 차트, 회의 탁자, 의자, 반투명 띠), 카펫 타일 바닥, 서랍장이 달린 책상 두 개, 휴지통, 화분 두 개.
- Codex 책상: 모니터 암에 단 모니터 3개, 키보드, 마우스 패드, 서류, 머그, 스탠드. Claude 책상: 받침대 위 넓은 터미널, 경고등, 책 더미, 전화기.
- 화면 내용, 스탠드 갓, 경고등 돔처럼 장면에 따라 바뀌는 것만 `art.ts`가 사각형으로 덧그린다. 위치는 `office.ts`가 내보내는 상수(`CODEX_MONITORS`, `SCREEN`, `TERMINAL`, `LAMP_HEAD`, `BEACON`)를 같이 쓴다.
- `pixels.ts`는 작은 그리기 도구다(사각형, 글자 격자, 색 섞기, 3×5 픽셀 글꼴, 고정 시드 난수). 같은 입력이면 늘 같은 그림이 나온다.

### 12.2 스프라이트

- 모든 그림은 코드에 쓴 픽셀 데이터다. 한 글자가 한 픽셀이고 `.`은 투명이다. 외부 이미지 에셋은 없다.
- 색은 `#rrggbb`이고, 빛처럼 비치는 것만 `#rrggbbaa`를 쓴다(`lamp-glow`, `alarm-glow`). 시트 로더는 `ImageData`로 한 번에 옮긴다.
- 캐릭터 프레임은 20×32다. 위 6줄은 팔을 올릴 자리이고, 그 아래에 머리, 어깨, 등받이 있는 사무용 의자(가스 실린더, 바퀴 다리)가 있다. 부품을 합친 뒤 에이전트 색으로 칠하고, 바깥에 어두운 외곽선을 자동으로 두른다(김은 빼고). 머리카락과 옷에는 밝은 면과 그늘이 있다.
  - Codex: 파란 셔츠, 검은 머리, 흰 헤드폰.
  - Claude: 코랄색 셔츠, 적갈색 머리를 금색 끈으로 묶은 올림머리.
  - 뒤돌아본 자세(`worried`)는 얼굴, 흰 깃, 사원증, 바지와 신발을 그린다.
- 자세 10개: `rest`, `nod`(머리 1픽셀 내림), `type0`, `type1`(손을 번갈아 키보드로), `fold`(팔짱), `chin`(턱 괴기), `head`(머리 감싸기), `cheer`(만세), `coffee`(김 나는 흰 머그), `worried`(뒤돌아본 얼굴과 땀방울).
- 소품: `office`(배경 240×122), `blueprint`(말린 끝이 있는 설계도), `lamp-glow`(스탠드 빛), `alarm-glow`(경고등 붉은 빛 세 겹), `pass-flag`(깃대와 초록 `PASS` 깃발, 픽셀 글꼴).
- 9단계의 `plant`, `mug` 소품은 배경에 들어가서 따로 두지 않는다.

### 12.3 장면별 동작 (프롬프트 3절 표)

| 장면 | Codex | Claude | 사무실 |
| --- | --- | --- | --- |
| `IDLE` | 책상에 펼친 설계도 앞에서 턱 괴기 | 팔짱 끼고 꺼진 터미널 보기 | 화면 꺼짐, 움직임 없음 |
| `CODEX_BUILDING` | 프레임마다 손을 바꾸는 폭풍 타이핑 | 의자를 끌고 와 Codex 뒤에서 팔짱 끼고 관찰 | 모니터 3개 켜짐(코드 두 화면이 흐르고 오른쪽 화면은 빌드 로그와 진행 막대), 스탠드 켜짐과 따뜻한 빛 |
| `CLAUDE_RUNNING` | 김 나는 커피 | 2프레임마다 타이핑, 좌우로 분주 | 터미널 매트릭스 효과(밝은 머리와 꼬리가 있는 9줄) |
| `CLAUDE_ALERT` | 의자를 뒤로 빼고 돌아앉아 걱정(얼굴, 땀방울). Codex 문제면 머리 감싸기, Codex 화면에 빨간 오류 줄과 Codex 책상 경고등 | 머리 감싸기, 터미널에 빨간 오류 로그 | 방 둘레 빨간 테두리, 경고등 점멸(밝은 프레임에 붉은 빛) |
| `SUCCESS` | 3프레임마다 고개 끄덕임 | 만세와 초록 `PASS` 깃발 | 색종이 18조각 |

`prefers-reduced-motion`이면 모든 움직임을 0프레임으로 고정한다(2단계 규칙 그대로).

### 12.4 시트 로더

- `art()`는 여전히 순수 함수다. 배경, 캐릭터, 소품은 `{ kind: "sprite", name, x, y, w, h }`로 내보낸다.
- 화면 쪽 `pixelSheet(SPRITES)`가 스프라이트를 처음 그릴 때 작은 캔버스로 한 번 만들어 두고, 그 뒤로는 `drawImage` 한 번으로 그린다.
- 다른 시트(예: PNG 아틀라스)로 바꾸려면 `SpriteSheet.draw(ctx, name, x, y)`를 구현하고 같은 이름을 주면 된다.
- 테스트:
  - 모든 자세가 20×32이고 색이 유효한지. 모든 스프라이트의 크기와 색 형식이 맞는지.
  - 배경이 240×122를 빈 곳 없이 채우고, 라벨 자리가 남는지.
  - 장면마다 첫 그리기가 배경 스프라이트이고 목록이 120개 미만인지.
  - 자세끼리, 두 에이전트끼리 그림이 다른지. 다섯 장면이 서로 다른지.
  - 경고 장면에서 경고등과 빨간 테두리가 모든 프레임에 있고 두 빨강을 오가는지.
  - `IDLE`이 프레임에 따라 바뀌지 않는지. reduced motion이면 모든 장면이 멈추는지.
  - 장면이 쓰는 스프라이트가 모두 있는지. 장면별 자세가 위 표와 같은지.
  - 그림이 캔버스 밖으로 나가지 않는지.

### 12.5 화면 확인 (`?demo=<ms>`, Playwright Chromium, 980×560 창에서 4배)

- 9단계: `screenshots/step9-idle.png`, `step9-codex-building.png`, `step9-claude-running.png`, `step9-alert.png`, `step9-success.png`. 처음 확인 때 커피잔이 1픽셀 갈색이라 안 보여서, 흰 잔과 김으로 바꾸고 다시 찍었다.
- 9b단계: `screenshots/step9b-idle.png`, `step9b-codex-building.png`, `step9b-claude-running.png`, `step9b-alert.png`, `step9b-success.png`.
- 9b단계 CPU(CDP `Performance.getMetrics`의 TaskDuration 증가분 ÷ 실제 시간): 대기 화면(`?workspace=E:/idle-check`, 30초) 0.128%, `?demo=2000`(20초) 0.361%.

## 13. 작업 구역과 여러 직원 (9c단계)

에이전트 세션마다, 서브에이전트마다 한 사람씩 사무실에 앉는다. 바닥은 다섯 작업 구역으로 나뉘고, 사람은 지금 하는 일에 맞는 구역으로 걸어간다. 9b단계의 중견기업 사무실 모양(벽, 창, 카펫, 책상, 색)은 그대로 두고 배치만 넓혔다.

### 13.1 캔버스와 배치 (`packages/ui/src/floor.ts`)

- 논리 크기를 240×135에서 320×180(16:9)으로 키웠다. 위 320×166이 사무실, 아래 14줄이 라벨 줄이다. 화면은 여전히 정수 배율로 키운다(1280×760 창에서 4배).
- 사람은 벽을 보고 앉아 있고 우리는 뒤에서 본다. 구역은 두 줄이다.
  - 뒷줄(벽 쪽): 출입문, 기획, 설계, 검토.
  - 가운데 통로.
  - 앞줄: 구현, (통로 틈), 작업.
  - 앞 통로.
- 구역마다 바닥에 옅은 구역 색과 테이프 선을 깔고, 이름표(색 네모와 한글 이름)를 단다. 뒷줄은 벽 위쪽에, 앞줄은 앞 통로 바닥에 둔다. 이름표 판은 배경에, 한글은 `art.ts`가 글자로 쓴다.

| 구역 | 이름 | 색 | 가구 | 일하는 화면 |
| --- | --- | --- | --- | --- |
| `plan` | 기획 | 노랑 | 화이트보드(순서도, 일정선, 포스트잇), 벽시계, 긴 회의 탁자와 노트북 3대, 물병과 컵 | 노트북에 메모 줄이 늘어남 |
| `design` | 설계 | 파랑 | 벽걸이 화면(구조도), 나무 틀 제도판 3개(청사진 모눈) | 제도판에 상자와 선이 차례로 그려짐 |
| `review` | 검토 | 보라 | 창, 책장, 긴 독서 책상, 검토 화면 3대, 책 더미, 스탠드, 빨간 표시가 있는 출력물 | 빨강/초록 diff 줄이 흐름 |
| `build` | 구현 | 초록 | 긴 개발 책상, 자리마다 모니터 2대, 머그, 노트, 선인장, 스탠드 | 두 화면에 코드가 흐름 |
| `run` | 작업 | 주황 | 서버 랙, 터미널 책상 3자리, 테스트 벤치(오실로스코프, 회로 기판과 탐침) | Claude는 매트릭스, Codex는 빌드 로그와 진행 막대. 누가 일하면 랙 불빛이 깜빡임 |

- 출입문(왼쪽 위, `EXIT` 표지, 매트)으로 사람이 들어오고 나간다. 누가 문을 지나는 동안 문이 열려 어둡게 보인다.
- 빈 자리마다 빈 의자를 배경에 그려 둔다. 그래서 빈자리가 빈자리로 보인다.
- 경고등은 기획과 설계 사이 벽에 달았고, `PIXEL OFFICE` 간판은 벽 가운데에 있다.

### 13.2 자리 규칙 (`assignSeats`)

- 구역마다 자리가 3개다(모두 15개, 최대 인원 12명보다 많다). 자리가 차면 그 구역 앞 통로에 28픽셀 간격으로 선다. 그 줄도 차면 반 칸 옆, 조금 위에 한 줄 더 선다. 12명이 한 구역에 몰려도 모두 다른 곳에 선다.
- 정하는 순서:
  1. 같은 구역에 그대로 있는 사람은 자리를 지킨다.
  2. 그 구역에 서 있던 사람은 빈자리가 생기면 앉고, 없으면 선 자리를 지킨다.
  3. 새로 온 사람과 구역을 바꾼 사람은 가장 앞 번호의 빈자리, 없으면 가장 앞 번호의 선 자리를 받는다.
- 동점은 장면의 `people` 순서(주 세션 먼저, 처음 본 순서)로 가른다. 시간에 따라 결과가 달라지지 않는다.
- 사람은 `id`로 따라간다. 구역 값이 이상하면 구현, 상태 값이 이상하면 쉬는 중으로 보고, 모르는 에이전트나 같은 `id`가 또 오면 버린다(`peopleOf`).

### 13.3 걷기 (`packages/ui/src/walk.ts`)

- 자리가 바뀌면 1초(`WALK_MS`) 동안 걸어간다. 거리와 상관없이 1초다.
- 길은 통로를 따른다. 자기 줄의 통로로 내려가거나 올라가고, 통로를 따라 옆으로 간 뒤 새 자리로 들어간다. 줄을 바꿀 때는 구현과 작업 사이 틈(`GAP_X`)으로 지나간다. 모든 구간은 가로나 세로다.
- 걷는 사람은 앞을 보고 선 그림이다. 다리와 팔을 바꾸는 2프레임(`walk0`, `walk1`)을 초당 8걸음으로 번갈아 그린다.
- 새로 온 사람은 문에서 걸어 들어오고, 떠난 사람은 문까지 걸어가서 사라진다. 걷는 도중 목적지가 바뀌면 지금 있는 곳에서 다시 출발한다.
- 페이지를 처음 열 때 이미 있던 사람은 걷지 않고 바로 자리에 있다.
- `prefers-reduced-motion`이면 아무도 걷지 않고 바로 새 자리에 나타난다(떠난 사람은 바로 사라진다).
- `nextStage(이전, 사람들, 지금, 즉시)`와 `actorsAt(stage, 지금)`은 순수 함수다. `main.ts`는 `Stage` 하나만 들고 있다. `art()`는 그대로 순수하고, 사람들의 현재 위치(`actors`)를 옵션으로 받는다. 옵션이 없으면 모두 자기 자리에 앉힌다.

### 13.4 사람 그림 (`packages/ui/src/figure.ts`)

- 9b단계 부품(머리, 몸, 의자, 자세별 팔)을 그대로 쓰고 `figure.ts`로 옮겼다. `sprites.ts`는 이름표 모음이다. 배경의 빈 의자도 같은 부품으로 그린다.
- 앉은 자세 11개: 9b단계 10개에 `raise`(한 손 들기)를 더했다. 선 자세 4개: `stand`, `walk0`, `walk1`, `hooray`(만세).
- 서브에이전트("인턴"): 2픽셀 작고 셔츠가 밝다. Codex 인턴은 헤드폰 대신 팀 색 비니, Claude 인턴은 올림머리 대신 짧은 꽁지머리다. 앞모습에는 사원증 대신 초록 목걸이와 출입증이 있다. 프레임 이름은 `codex-sub/type0`처럼 `-sub`가 붙는다.
- 서브에이전트의 `role`(예: `Explore`)은 작은 어두운 이름표로 쓴다. 앉아 있으면 의자 아래, 서 있거나 걸으면 머리 위다. 인쇄 가능한 글자만 남기고, 26픽셀(라틴 글자 약 7자)을 넘으면 자르고 `…`를 붙인다. 캔버스 `fillText`로만 그리므로 HTML로 해석되는 일이 없다. 이름표는 모든 사람을 그린 뒤에 그려서 옆 사람에게 가리지 않는다.
- 상태별 모습:

| 상태 | 앉아서 | 서서 | 화면 |
| --- | --- | --- | --- |
| `working` | 타이핑(Codex는 매 프레임, Claude는 2프레임마다 손을 바꿈) | 서 있음 | 구역별 일하는 화면(13.1 표) |
| `waiting` | 한 손 들기와 흰 `?` 말풍선 | `?` 말풍선 | 입력 대기 프롬프트 |
| `alert` | 머리 감싸기와 빨간 `!` 말풍선 | `!` 말풍선 | 빨간 오류 줄 |
| `success` | 만세와 고개 끄덕임을 3프레임마다 번갈아 | 만세와 서기를 번갈아 | 초록 완료 줄 |
| `idle` | Codex 턱 괴기, Claude 팔짱. 다른 사람이 일하는 중이면 주 세션은 커피 | 서 있음 | 꺼짐 |

- 사무실 전체 효과는 9b단계와 같다. `CLAUDE_ALERT`면 벽 경고등 점멸과 붉은 빛, 방 둘레 빨간 테두리. `SUCCESS`면 처음 완료한 사람 옆에 `PASS` 깃발과 색종이 24조각. `CODEX_BUILDING`이면 구현 책상 스탠드와 따뜻한 빛.
- 사람은 화면 위쪽(뒤)부터 아래쪽(앞) 순서로 그려서 앞사람이 뒷사람을 가린다.

### 13.5 라벨 줄

- 왼쪽: `■ Codex 1  ■ Claude 2  서브 1`(주 세션 수, 서브에이전트 수). 12명을 넘어 못 그린 사람이 있으면 노란 `+N`.
- 오른쪽: 상태별 인원을 급한 순서로, 상태마다 제 색으로. 예: `문제 1 · 대기 1 · 작업 2 · 완료 1 · 쉼 2`(빨강, 노랑, 초록, 초록, 회색).
- 아무도 없으면 `사무실이 비어 있음`. 연결 끊김 배너(`연결 안 됨: 다시 연결하는 중`)는 그대로다.
- 옛 서버가 보낸 장면에 `people`이 없으면 Codex 한 명(구현)과 Claude 한 명(작업)을 `desks`의 상태로 앉힌다. 페이지가 깨지지 않는다.

### 13.6 화면 갱신과 CPU

- 움직이지 않는 가구는 모두 배경 스프라이트 하나(320×166)에 있다.
- 기본은 초당 10번 그리고, 그림 목록이 바뀔 때만 다시 칠한다. 누군가 걷는 동안만 초당 20번으로 올리고, 다 도착하면 바로 10번으로 돌아간다. 애니메이션 프레임은 시계로 정하므로 걷는 동안에도 다른 움직임의 속도는 같다.
- 쉬는 장면은 프레임이 바뀌어도 그림이 같다(쉬는 사람, 꺼진 화면, 멈춘 랙).
- CPU(CDP `Performance.getMetrics`의 TaskDuration 증가분 ÷ 실제 시간, Playwright Chromium, 1280×760):

| 화면 | 시간 | CPU |
| --- | --- | --- |
| `?workspace=E:/idle-check`(사람 없음) | 30초 | 0.175% |
| `?demo=18000`(쉬는 사람 3명) | 20초 | 0.185% |
| `?demo`(멈추지 않은 데모, 걷기 포함) | 20초 | 0.529% |

### 13.7 테스트 (`packages/ui/test/art.test.ts`, `floor.test.ts`, `walk.test.ts`)

- 9b단계에서 남긴 것: 다섯 장면이 서로 다름, 경고 장면에서 경고등과 테두리가 모든 프레임에 있고 두 빨강을 오감, reduced motion이면 멈춤, 모든 그림이 캔버스 안(걷는 중과 이름표, 가운데·오른쪽 정렬 글자 포함), 스프라이트 모양과 색 형식, 쉬는 사무실은 움직이지 않음(사람 없음, 3명, 12명), 첫 그리기가 배경.
- 새로 넣은 것:
  - 1, 4, 12명이 모두 그려지고 13명(또는 `hidden: 1`)이면 12명과 `+1`.
  - 모두 자기 구역 안의 서로 다른 곳에 앉음. 구역마다 자리 3개가 그 구역 범위 안에 있음.
  - 자리 유지: 다른 사람이 오가도 자리를 지킴, 구역을 바꾸면 새 구역 자리, 꽉 차면 서고 자리가 나면 앉음, 한 구역 12명.
  - 걷기: 1초 안팎, 시작과 끝 위치, 길의 모든 구간이 가로나 세로이고 중간 위치가 길 위에 있음, 줄을 바꾸면 틈으로 지남, 2프레임 걸음, 문으로 들어오고 나감, 걷는 중 목적지 변경, reduced motion이면 걷지 않음, 처음 열 때는 걷지 않음.
  - 상태별 자세와 말풍선, 일하는 사람의 화면만 켜짐, 인턴 모습과 이름표, `role` 정리와 자르기, 라벨 줄 숫자와 색, `people`이 없는 옛 장면.
- `npm test -w packages/ui`: 테스트 48개 모두 통과(art 26, floor 9, walk 9, backoff 2, token 2).

### 13.8 화면 확인 (`?demo=<ms>`, Playwright Chromium, 1280×760 창에서 4배)

- `screenshots/step9c-codex-building.png`(2초, 1명), `step9c-three-people.png`(4.6초, 3명), `step9c-four-people.png`(6초, 서브에이전트 `Explore` 포함 4명), `step9c-alert.png`(10초), `step9c-success.png`(14초), `step9c-idle.png`(18초, 쉬는 3명).
- 걷기(`?demo`, 멈추지 않음): `step9c-walk-1.png`, `step9c-walk-2.png`, `step9c-walk-3.png`(2초 무렵 Codex가 기획에서 구현으로, 틈을 지나 걸어감), `step9c-walk-in.png`(4.7초 무렵 Claude 두 명이 문에서 들어옴).
- `step9c-crowd-13.png`: 데모에 없는 큰 장면(13명, 서브 9명, 여러 상태, 한 구역 초과)을 페이지 안에서 빌드된 `art()`로 그린 것. 서 있는 사람, 이름표, 말풍선, `+1`을 보려고 찍었다.
- 처음 확인 때 서 있는 인턴의 이름표가 옆 사람에게 가려지고 서로 붙어서, 이름표를 머리 위로 옮기고 맨 나중에 그리며 선 자리 간격을 16에서 28픽셀로 넓혔다. 상태 줄이 한 색이라 상태마다 색을 나눴다. 설계 구역의 도면 통은 기둥처럼 보여서 뺐다.

### 13.9 확인하지 못한 것

- 실제 서버(새 `people`을 보내는 코어)에 연결한 화면은 보지 않았다. 데모와 페이지 안 렌더링으로만 확인했다.
- 옛 서버 장면(`people` 없음)은 테스트로만 확인했다.
- 한글 글자 너비는 6px monospace에서 글자당 6픽셀로 어림한다. 글꼴에 따라 라벨 줄 오른쪽 상태 사이 간격이 조금 넓거나 좁을 수 있다.
- VS Code 웹뷰와 Orca 브라우저에서의 모습과 CPU는 다시 재지 않았다.
- `prefers-reduced-motion`은 테스트로만 확인했고 브라우저에서 켜 보지는 않았다.

### 13.10 구역과 서브에이전트를 정하는 쪽 (`packages/core/src/zones.ts`, `state.ts`)

- **구역 판단:** 에이전트가 부른 도구로 정하는 추정이다. 파일 경로와 명령은 사용자 PC의 훅 안에서 구역을 고르는 데만 읽고, 서버로는 구역 이름만 보낸다.
  - 기획: 지시를 막 받음(`UserPromptSubmit`), 계획 모드(`permission_mode: "plan"`), 할 일 목록, 사용자에게 질문, 서브에이전트에게 일 넘기기(`Task`, `Agent`), Codex `update_plan`.
  - 설계: 문서 편집(`.md`, `.mdx`, `.rst`, `.txt`, `.adoc`, 또는 `docs/`, `design/`, `adr/`, `spec/`, `rfc/` 아래). Codex `apply_patch`는 패치 안의 파일이 모두 문서일 때.
  - 구현: 그 밖의 파일 편집과 생성.
  - 작업: 셸 명령(테스트 포함).
  - 검토: 파일 읽기와 검색, 웹 조회, 읽기 전용 셸 명령(`cat`, `grep`, `rg`, `git diff/log/show/status` 등. `&&` 같은 연결이 있으면 작업).
  - 모르는 도구(MCP 도구 등)는 구역을 바꾸지 않는다. 응답 대기, 문제 발생, 완료는 그 자리에서 보여 준다.
- **서브에이전트:** Claude Code 공식 문서대로 서브에이전트 안의 훅에는 `agent_id`와 `agent_type`이 붙는다. `agent_id`가 있으면 `subagentId`, `agent_type`은 `role`(40자 이하)로 보낸다. `agent_type`만 있으면(`--agent`로 연 세션) 서브에이전트가 아니다. `SubagentStart`는 start, `SubagentStop`은 stop이다(`last_assistant_message`는 버림). 두 훅은 `init`이 등록한다.
  - 상태 키는 `claude:<세션>/<agent_id>`다. 첫 구역은 종류로 정한다(review/explore 계열 검토, plan 기획, design/architect 설계, test/debug 작업, 그 밖 구현).
  - 끝나면 완료로 4초 보인 뒤 사라지고, 30초 동안 아무 일이 없어도 사라진다. 서브에이전트가 일하는 동안 부모 세션은 쉬는 중으로 바뀌지 않는다.
- **사람 목록:** `scene().people`. 본 세션이 먼저, 그다음 서브에이전트, 각각 처음 본 순서다. 최대 12명이고 나머지는 `hidden`으로 센다.
- **서버:** `zone`(다섯 값 중 하나), `subagentId`(1~200자), `role`(40자 이하)만 받고, 제어 문자는 거절한다.
- **Codex:** 같은 규칙으로 구역을 보낸다. Codex의 서브에이전트 신호는 확인하지 못해서 다루지 않는다. Codex의 `apply_patch`, `update_plan` 같은 도구 이름은 문서를 보고 넣었고, 실제 Codex 훅에서 확인한 이름은 `Bash`뿐이다.
- **실제 확인 (2026-11-09):** 새 서버에서 `?workspace=D:/aaa`를 열고 이 개발 세션(Claude Code)이 Explore 서브에이전트를 띄웠다. 본 세션은 기획(서브에이전트에게 일을 넘김), 서브에이전트는 `Explore` 이름표를 달고 검토 구역에 나타났고 끝나자 만세했다. 캡처: `screenshots/step9c-live-subagent.png`. `init`으로 `SubagentStart`, `SubagentStop` 훅을 사용자 Claude 설정에 더했다(사용자 승인, 백업 있음).

## 14. 설치 점검과 README (10단계)

### 14.1 `pixel-office doctor` (`packages/cli/src/doctor.ts`)

프롬프트 7절의 CLI 목록에 있던 명령이다. 새 PC에 설치한 뒤나 업데이트한 뒤 무엇을 더 해야 하는지 알려 준다. 읽기만 하고, 파일을 쓰거나 서버를 띄우지 않으며, 토큰을 출력하지 않는다. 홈 폴더는 `~`로 줄여 보여 준다.

| 점검 | 정상 | 주의 / 문제 |
|---|---|---|
| Node.js | 20 이상 | 20 미만은 문제 |
| 화면 파일 | `packages/ui/dist/web/index.html` 있음 | 없으면 문제(`npm run build`) |
| 서버 | `server.json`의 포트가 `/health`에 응답 | 기록만 있고 응답이 없으면 주의, 꺼져 있으면 참고 |
| Claude Code 훅, Codex 훅 | 이벤트마다 `init`이 지금 쓸 그룹이 그대로 있음 | 하나도 없으면 문제, 옛 경로이거나 빠진 이벤트가 있으면 주의(빠진 이벤트 이름을 보여 줌) |
| Codex 래퍼(Windows) | 내용이 지금 빌드로 만든 것과 같음 | 없거나 다르면 주의 |
| Codex 신뢰, 작업 폴더 주소, Orca 여부 | 참고로만 보여 줌 | |

- 훅 비교는 텍스트가 아니라 파싱한 그룹으로 한다(`settings.ts`의 `hookStatus`). 사람이 줄 바꿈을 바꾼 파일도 정상으로 본다.
- 종료 코드는 문제가 하나라도 있으면 1, 아니면 0이다. 주의만 있으면 0이다.
- Orca 터미널 안(`ORCA_WORKTREE_ID`가 있음)에서는 Orca가 정한 `CLAUDE_CONFIG_DIR`, `CODEX_HOME`을 따라가므로 Orca의 설정 사본을 점검한다. 이때 고치는 방법은 "Orca 밖에서 init, 그다음 Orca 재시작"으로 안내한다. Orca 안에서 init을 하면 다음 시작 때 덮어써지기 때문이다.
- **실제 확인 (2026-11-09):** 이 PC의 사용자 설정에서는 모두 정상이었다(Claude 이벤트 9개, Codex 이벤트 6개, 래퍼). Orca의 설정 사본(`%APPDATA%\orca\claude-profiles\<id>\home`, `codex-accounts\<id>\home`)을 같은 방법으로 점검하니 Claude 쪽에 `SubagentStart`, `SubagentStop`이 빠져 있었다. 9c단계의 init 뒤에 Orca를 다시 시작하지 않았기 때문이고, 11절의 설명과 맞다.

### 14.2 README

설치(새 PC), VS Code, Orca, 브라우저, 명령, 업데이트, 한계(훅 신호로 정하는 것과 추정하는 것), 완료 기준 점검, CPU, 보안을 README 한 곳에 모았다. 근거는 이 문서의 각 절과 `screenshots/`를 가리킨다.

### 14.3 `.vsix` 패키지 (`packages/vscode/scripts/package.mjs`)

- 저장소의 `node_modules/@pixel-office/*`는 워크스페이스 링크라서 vsix에 그대로 담을 수 없다. 스크립트가 `packages/vscode/dist/package`에 확장(`dist/src`, `package.json`, README, LICENSE)과 빌드된 core(`dist/src`), cli(`dist/src`), ui(`dist/web`), `ws`를 복사하고 그 폴더에서 `vsce package`를 돌린다.
- `vsce --no-dependencies`는 node_modules를 통째로 빼므로 쓰지 않는다. 의존성 목록을 남겨 두면 vsce가 `npm list --production`으로 복사본을 찾아 넣는다.
- 패키징 도구는 `@vscode/vsce` 4.1.0(고정, 개발 의존성)이다. Node 22 이상이 필요해서 CI는 Node 24에서만 패키징한다. 서명용 `@vscode/vsce-sign`의 설치 스크립트는 허용하지 않았다(패키징에는 필요 없음).
- 결과: `pixel-office-0.0.1.vsix`, 파일 68개, 약 134KB.
- **실제 확인 (2026-11-09, VS Code 1.145.2):**
  - vsix를 저장소 밖 폴더에 풀어, 그 안의 cli로 서버를 띄웠다. 화면 파일 경고 없이 떴고, 확장 위치에서 core와 cli를 찾았다.
  - 사용자 VS Code를 건드리지 않도록 임시 `--user-data-dir`, `--extensions-dir`에 설치하고, `D:\aaa\skill_kit_kch`를 연 새 창에서 확장이 사무실 탭을 자동으로 열었다. 9c 화면에 이 개발 세션(Claude)이 작업 구역에 보였다. 캡처: `screenshots/step10-vscode-vsix.png`.
