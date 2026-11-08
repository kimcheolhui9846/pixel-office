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

Node.js 20 이상이 필요하다. 라이선스는 MIT다.
