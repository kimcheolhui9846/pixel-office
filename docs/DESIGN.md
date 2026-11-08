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
- Codex 훅에서 셸 명령의 종료 코드를 얻을 수 있는지.

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
