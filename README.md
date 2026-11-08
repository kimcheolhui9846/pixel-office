# pixel-office

Codex와 Claude Code가 일하는 상태를 2D 픽셀 사무실로 실시간으로 보여 주는 도구다. VS Code와 Orca 양쪽에서 같은 화면을 띄우는 것이 목표다.

**개발 중.** 설계와 0단계 확인 결과는 `docs/DESIGN.md`에 있다.

## 개발

```bash
npm install
npm test
```

데모 화면(에이전트 없이 장면 5개를 돈다):

```bash
npm run build
python -m http.server 47918 --bind 127.0.0.1 --directory packages/ui/dist/web
```

브라우저에서 `http://127.0.0.1:47918/?demo`를 연다. `?demo=6000`은 6초 시점에 멈춘다.

로컬 서버(기본 포트 47821, `127.0.0.1`에만 연다):

```bash
npm run build
npx pixel-office start              # 포그라운드로 실행, Ctrl+C로 종료. --port N으로 포트 변경
npx pixel-office simulate --loops 1 # 다른 터미널에서: 데모 이벤트를 서버로 보낸다
```

`start`가 출력한 `http://127.0.0.1:47821/`을 브라우저로 연다. 서버 정보(`server.json`)는 `~/.pixel-office`에 쓰며, `PIXEL_OFFICE_HOME`으로 폴더를 바꿀 수 있다. 보안 설계는 `docs/DESIGN.md` 6절에 있다.

### Claude Code 연결 (`init`, `uninit`)

```bash
npm run build
npx pixel-office init --dry-run   # 바뀔 내용을 diff로만 본다
npx pixel-office init             # diff를 보여 주고 "적용할까요? (y/N)"를 묻는다. --yes면 묻지 않는다
npx pixel-office uninit           # init이 넣은 훅만 지운다
```

> **주의:** `init`은 Claude Code 사용자 설정 `~/.claude/settings.json`을 고친다(`CLAUDE_CONFIG_DIR`이 있으면 그 폴더의 `settings.json`). 고치기 전에 diff를 보여 주고, 확인을 받은 뒤, 원래 파일을 `~/.pixel-office/backups/<시각>/claude-settings.json`에 백업한다. 다른 훅(Orca, skill kit 등)과 다른 설정은 그대로 둔다. 터미널이 아닌 곳에서 `--yes` 없이 실행하면 아무것도 쓰지 않고 종료 코드 64로 끝난다.

- 훅은 서버가 꺼져 있어도 조용히 끝난다(0.5초 제한, 출력 없음). 백그라운드(`async`)로 돌아서 Claude를 기다리게 하지 않는다.
- 저장소를 옮기거나 node를 바꾸면 `init`을 다시 실행한다. 예전 항목이 새 항목으로 바뀐다.
- WSL 안에서 실행하면 훅이 Windows 쪽 `.pixel-office` 폴더를 읽도록 설정한다. 자동으로 찾지 못하면 `--windows-home /mnt/c/Users/<이름>`을 준다. WSL은 mirrored networking이어야 한다.
- 자세한 내용은 `docs/DESIGN.md` 7절에 있다.

Node.js 20 이상이 필요하다. 라이선스는 MIT다.
