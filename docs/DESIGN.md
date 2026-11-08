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
