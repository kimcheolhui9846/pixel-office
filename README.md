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

Node.js 20 이상이 필요하다. 라이선스는 MIT다.
