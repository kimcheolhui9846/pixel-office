import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEMO_LOOP_MS, demoScene, type Person, type Scene, type SceneMode, type Zone } from "@pixel-office/core";

import { art, HEIGHT, type Op, roleTag, textWidth, WIDTH } from "../src/art.js";
import { ROOM_H, SEATS, ZONE_AREAS } from "../src/floor.js";
import { ROOM_W } from "../src/office.js";
import { CHAR_H, CHAR_W, frameName, POSES, SPRITES } from "../src/sprites.js";
import { actorsAt, nextStage } from "../src/walk.js";

const base = { frame: 0, reducedMotion: false, connected: true };
const MODES: SceneMode[] = ["IDLE", "CODEX_BUILDING", "CLAUDE_RUNNING", "CLAUDE_ALERT", "SUCCESS"];

/** A scene in one of the five modes with a Codex at 구현 and a Claude at 작업, as before 9c. */
function sceneOf(mode: SceneMode, focus: Scene["focus"] = null): Scene {
  const desks: Scene["desks"] = { codex: "idle", claude: "idle" };
  if (mode === "CODEX_BUILDING") desks.codex = "working";
  if (mode === "CLAUDE_RUNNING") desks.claude = "working";
  if (mode === "CLAUDE_ALERT") desks[focus ?? "claude"] = "alert";
  if (mode === "SUCCESS") desks.claude = "success";
  const people: Person[] = [
    { id: "codex:a", agent: "codex", kind: "main", status: desks.codex, zone: "build" },
    { id: "claude:b", agent: "claude", kind: "main", status: desks.claude, zone: "run" },
  ];
  return { mode, focus: focus ?? (mode === "IDLE" ? null : mode.startsWith("CODEX") ? "codex" : "claude"), desks, people, hidden: 0 };
}

function crowd(n: number, status: Person["status"] = "working", zones: readonly Zone[] = ["plan", "design", "build", "run", "review"]): Person[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    agent: i % 2 === 0 ? "codex" : "claude",
    kind: i < 2 ? "main" : "sub",
    role: i < 2 ? undefined : `Role${i}`,
    status,
    zone: zones[i % zones.length]!,
  })).map(({ role, ...p }) => (role === undefined ? p : { ...p, role })) as Person[];
}

function withPeople(people: Person[], hidden = 0, mode: SceneMode = "CODEX_BUILDING"): Scene {
  return { mode, focus: mode === "IDLE" ? null : "codex", desks: { codex: "working", claude: "working" }, people, hidden };
}

const tags = (ops: Op[]) => new Set(ops.map((o) => o.tag).filter(Boolean));
const drawnPeople = (ops: Op[]) => ops.filter((o): o is Extract<Op, { kind: "sprite" }> => o.kind === "sprite" && o.id !== undefined);
const texts = (ops: Op[]) => ops.filter((o): o is Extract<Op, { kind: "text" }> => o.kind === "text");

describe("art", () => {
  test("each scene has its own marks", () => {
    assert.ok(tags(art(sceneOf("CODEX_BUILDING"), base)).has("lamp-on"));
    assert.ok(tags(art(sceneOf("CODEX_BUILDING"), base)).has("code"));
    assert.ok(tags(art(sceneOf("CLAUDE_RUNNING"), base)).has("matrix"));
    assert.ok(tags(art(sceneOf("CLAUDE_RUNNING"), base)).has("rack-led") || tags(art(sceneOf("CLAUDE_RUNNING"), { ...base, frame: 1 })).has("rack-led"));
    assert.ok(tags(art(sceneOf("CLAUDE_ALERT"), base)).has("alarm-on"));
    assert.ok(tags(art(sceneOf("CLAUDE_ALERT"), base)).has("claude-head"));
    assert.ok(tags(art(sceneOf("SUCCESS"), base)).has("pass-flag"));
    assert.ok(tags(art(sceneOf("SUCCESS"), base)).has("confetti"));
    const idle = tags(art(sceneOf("IDLE"), base));
    for (const t of ["lamp-on", "matrix", "code", "alarm-on", "pass-flag", "confetti", "rack-led"]) {
      assert.ok(!idle.has(t), t);
    }
  });

  test("the five scenes all look different", () => {
    const pictures = new Set(MODES.map((m) => JSON.stringify(art(sceneOf(m), base))));
    assert.equal(pictures.size, 5);
  });

  test("during an alert the alarm and the red frame show on every frame", () => {
    const off = art(sceneOf("IDLE"), base).find((o) => o.tag === "alarm-off")!;
    assert.ok(off.kind === "rect");
    const reds = new Set<string>();
    for (const frame of [0, 1, 2, 3]) {
      const ops = art(sceneOf("CLAUDE_ALERT"), { ...base, frame });
      const alarm = ops.find((o) => o.tag === "alarm-on")!;
      assert.ok(alarm.kind === "rect" && alarm.color !== off.color, `frame ${frame}`);
      reds.add(alarm.color);
      assert.equal(ops.filter((o) => o.tag === "alert-glow").length, 4);
      assert.ok(tags(ops).has("bubble-alert"), "the person in trouble shows a red bubble");
    }
    assert.equal(reds.size, 2, "the light blinks between two reds");
  });

  test("animation changes frames, reduced motion does not", () => {
    const s = sceneOf("CLAUDE_RUNNING");
    assert.notDeepEqual(art(s, { ...base, frame: 1 }), art(s, { ...base, frame: 2 }));
    const scenes = [...MODES.flatMap((m) => [sceneOf(m, "codex"), sceneOf(m, "claude")]), withPeople(crowd(12)), demoScene(6_000)];
    for (const scene of scenes) {
      const still = art(scene, { ...base, frame: 0, reducedMotion: true });
      for (const frame of [1, 2, 3, 7]) {
        assert.deepEqual(art(scene, { ...base, frame, reducedMotion: true }), still, scene.mode);
      }
    }
  });

  test("the same input always draws the same picture", () => {
    const s = withPeople(crowd(7));
    assert.deepEqual(art(s, { ...base, frame: 3 }), art(s, { ...base, frame: 3 }));
  });

  test("a lost connection shows a banner", () => {
    assert.ok(tags(art(sceneOf("IDLE"), { ...base, connected: false })).has("disconnected"));
    assert.ok(!tags(art(sceneOf("IDLE"), base)).has("disconnected"));
  });

  test("everything is drawn inside the canvas", () => {
    const scenes = [...MODES.map((m) => sceneOf(m)), withPeople(crowd(12)), withPeople(crowd(12, "alert", ["run"]), 3, "CLAUDE_ALERT")];
    for (const scene of scenes) {
      // seated, and while walking in from the door to every seat
      const stage = nextStage(nextStage(null, [], 0, false), scene.people, 0, false);
      const moments = [undefined, ...[0, 100, 300, 500, 700, 900].map((t) => actorsAt(stage, t))];
      for (const actors of moments) {
        for (let frame = 0; frame < 30; frame += 1) {
          for (const op of art(scene, { ...base, frame, connected: false, ...(actors ? { actors } : {}) })) {
            const where = `${scene.mode} ${JSON.stringify(op)}`;
            if (op.kind === "text") {
              const w = textWidth(op.text);
              const left = op.align === "center" ? op.x - w / 2 : op.align === "right" ? op.x - w : op.x;
              assert.ok(left >= 0 && left + w <= WIDTH && op.y <= HEIGHT && op.y - 6 >= 0, where);
            } else {
              assert.ok(op.x >= 0 && op.y >= 0 && op.x + op.w <= WIDTH && op.y + op.h <= HEIGHT, where);
            }
          }
        }
      }
    }
  });
});

describe("people", () => {
  test("one person per entry: 1, 4 and 12 are all drawn, 13 shows +1", () => {
    for (const n of [1, 4, 12]) {
      const ops = art(withPeople(crowd(n)), base);
      assert.equal(drawnPeople(ops).length, n, `${n}`);
      assert.equal(new Set(drawnPeople(ops).map((o) => o.id)).size, n);
      assert.ok(!tags(ops).has("label-hidden"), `${n}`);
    }
    // the core sends at most 12 and counts the rest in `hidden`
    const ops = art(withPeople(crowd(12), 1), base);
    assert.equal(drawnPeople(ops).length, 12);
    assert.ok(texts(ops).some((t) => t.tag === "label-hidden" && t.text === "+1"));
    // a scene that carries 13 anyway: 12 drawn, +1
    const extra = art(withPeople(crowd(13)), base);
    assert.equal(drawnPeople(extra).length, 12);
    assert.ok(texts(extra).some((t) => t.tag === "label-hidden" && t.text === "+1"));
  });

  test("everyone sits in their own zone, in a different place", () => {
    const people = crowd(12);
    const ops = art(withPeople(people), base);
    const places = new Set<string>();
    for (const p of people) {
      const op = drawnPeople(ops).find((o) => o.id === p.id)!;
      const area = ZONE_AREAS[p.zone];
      assert.ok(op.x >= area.x && op.x + CHAR_W <= area.x + area.w, `${p.id} ${p.zone} at ${op.x}`);
      places.add(`${op.x},${op.y}`);
    }
    assert.equal(places.size, people.length);
  });

  test("statuses have their poses and bubbles", () => {
    const one = (status: Person["status"], agent: Person["agent"] = "codex", frame = 0, mode: SceneMode = "CODEX_BUILDING") =>
      art(withPeople([{ id: "x", agent, kind: "main", status, zone: "build" }], 0, mode), { ...base, frame });
    const pose = (ops: Op[]) => drawnPeople(ops)[0]!.tag;
    assert.equal(pose(one("working", "codex", 0)), "codex-type0");
    assert.equal(pose(one("working", "codex", 1)), "codex-type1");
    assert.equal(pose(one("waiting")), "codex-raise");
    assert.ok(tags(one("waiting")).has("bubble-wait"));
    assert.equal(pose(one("alert")), "codex-head");
    assert.ok(tags(one("alert")).has("bubble-alert"));
    assert.equal(pose(one("success", "claude", 0)), "claude-cheer");
    assert.equal(pose(one("success", "claude", 3)), "claude-nod");
    assert.equal(pose(one("idle", "codex", 0, "IDLE")), "codex-chin");
    assert.equal(pose(one("idle", "claude", 0, "IDLE")), "claude-fold");
    assert.equal(pose(one("idle", "claude", 0, "CODEX_BUILDING")), "claude-coffee");
  });

  test("a working person's screens light up, an idle person's stay dark", () => {
    for (const zone of ["plan", "design", "build", "run", "review"] as const) {
      const working = art(withPeople([{ id: "x", agent: "codex", kind: "main", status: "working", zone }]), base);
      assert.ok(tags(working).has(`screen-${zone}`), zone);
      const idle = art(withPeople([{ id: "x", agent: "codex", kind: "main", status: "idle", zone }], 0, "IDLE"), base);
      assert.ok(!tags(idle).has(`screen-${zone}`), zone);
    }
  });

  test("subagents look different and wear their role as a name tag", () => {
    const people: Person[] = [
      { id: "m", agent: "claude", kind: "main", status: "working", zone: "review" },
      { id: "s", agent: "claude", kind: "sub", role: "Explore", status: "working", zone: "review" },
    ];
    const ops = art(withPeople(people), base);
    const [main, sub] = [drawnPeople(ops).find((o) => o.id === "m")!, drawnPeople(ops).find((o) => o.id === "s")!];
    assert.ok(main.name.startsWith("claude/"));
    assert.ok(sub.name.startsWith("claude-sub/"));
    assert.notDeepEqual(SPRITES[main.name]!.px, SPRITES[sub.name]!.px);
    assert.ok(texts(ops).some((t) => t.tag === "name-tag" && t.text === "Explore"));
  });

  test("a role is only ever text, cleaned and cut to fit", () => {
    assert.equal(roleTag("Explore"), "Explore");
    assert.equal(roleTag(undefined), "");
    assert.equal(roleTag("a\u0000b\nc\u007f"), "abc");
    const long = roleTag("<img src=x onerror=alert(1)>");
    assert.ok(long.endsWith("…") && textWidth(long) <= 26, long);
    assert.ok(textWidth(roleTag("코드리뷰어전문가")) <= 26);
  });

  test("the label bar counts people for any number of them", () => {
    const people: Person[] = [
      { id: "a", agent: "codex", kind: "main", status: "working", zone: "build" },
      { id: "b", agent: "claude", kind: "main", status: "alert", zone: "run" },
      { id: "c", agent: "claude", kind: "main", status: "working", zone: "design" },
      { id: "d", agent: "claude", kind: "sub", role: "Explore", status: "waiting", zone: "review" },
    ];
    const t = texts(art(withPeople(people), base));
    const all = t.map((o) => o.text);
    for (const want of ["Codex 1", "Claude 2", "서브 1"]) assert.ok(all.includes(want), want);
    const status = t.filter((o) => o.tag === "label-status");
    assert.deepEqual(status.map((o) => o.text), ["문제 1", "대기 1", "작업 2"]);
    assert.equal(new Set(status.map((o) => o.color)).size, 3, "each status in its own colour");
    assert.equal(texts(art(withPeople([], 0, "IDLE"), base)).find((o) => o.tag === "label-people")!.text, "사무실이 비어 있음");
  });

  test("a scene from an older server (no people) still shows a Codex and a Claude", () => {
    const { people: _people, hidden: _hidden, ...old } = sceneOf("CLAUDE_RUNNING");
    const ops = art(old as Scene, base);
    const drawn = drawnPeople(ops);
    assert.equal(drawn.length, 2);
    const codex = drawn.find((o) => o.name.startsWith("codex/"))!;
    const claude = drawn.find((o) => o.name.startsWith("claude/"))!;
    assert.deepEqual([codex.x, codex.y], [SEATS.build[0]!.x, SEATS.build[0]!.y]);
    assert.deepEqual([claude.x, claude.y], [SEATS.run[0]!.x, SEATS.run[0]!.y]);
    assert.ok(tags(ops).has("matrix"));
    assert.ok(texts(ops).some((o) => o.text === "Codex 1") && texts(ops).some((o) => o.text === "Claude 1"));
  });

  test("walkers use the walk frames and open the door", () => {
    const stage = nextStage(nextStage(null, [], 0, false), [{ id: "n", agent: "codex", kind: "main", status: "working", zone: "build" }], 0, false);
    const early = art(withPeople([...stage.people.values()]), { ...base, actors: actorsAt(stage, 10) });
    assert.match(drawnPeople(early)[0]!.name, /\/walk[01]$/);
    assert.ok(tags(early).has("door-open"));
    const later = art(withPeople([...stage.people.values()]), { ...base, actors: actorsAt(stage, 2_000) });
    assert.match(drawnPeople(later)[0]!.name, /\/type[01]$/);
    assert.ok(!tags(later).has("door-open"));
  });
});

describe("demo", () => {
  test("the loop walks through the five scenes in order", () => {
    const at = (s: number) => demoScene(s * 1000).mode;
    assert.deepEqual([at(2), at(6), at(10), at(14), at(18)], ["CODEX_BUILDING", "CLAUDE_RUNNING", "CLAUDE_ALERT", "SUCCESS", "IDLE"]);
  });

  test("the loop repeats", () => {
    assert.deepEqual(demoScene(6_000), demoScene(6_000 + 3 * DEMO_LOOP_MS));
  });

  test("the demo office fills up and empties", () => {
    const count = (ms: number) => drawnPeople(art(demoScene(ms), base)).length;
    assert.deepEqual([count(2_000), count(4_600), count(6_000), count(18_000)], [1, 3, 4, 3]);
    const sub = drawnPeople(art(demoScene(6_000), base)).find((o) => o.name.includes("-sub/"))!;
    const review = ZONE_AREAS.review;
    assert.ok(sub.x >= review.x && sub.x < review.x + review.w);
  });
});

describe("sprites", () => {
  test("every pose of every look is a 20 x 32 frame with real pixels", () => {
    for (const agent of ["codex", "claude"] as const) {
      for (const sub of [false, true]) {
        for (const pose of POSES) {
          const s = SPRITES[frameName(agent, sub, pose)]!;
          assert.equal(s.w, CHAR_W);
          assert.equal(s.h, CHAR_H);
          assert.equal(s.px.length, CHAR_W * CHAR_H);
          assert.ok(s.px.filter((p) => p !== null).length > 180, `${agent} ${sub} ${pose}`);
          assert.ok(s.px.every((p) => p === null || /^#[0-9a-f]{6}$/.test(p)));
        }
      }
    }
  });

  test("poses differ, and agents and interns look different", () => {
    for (const agent of ["codex", "claude"] as const) {
      for (const sub of [false, true]) {
        const frames = new Set(POSES.filter((p) => p !== "nod").map((p) => JSON.stringify(SPRITES[frameName(agent, sub, p)]!.px)));
        assert.equal(frames.size, POSES.length - 1, `${agent} ${sub}`);
      }
    }
    assert.notDeepEqual(SPRITES["codex/rest"]!.px, SPRITES["claude/rest"]!.px);
    assert.notDeepEqual(SPRITES["codex/rest"]!.px, SPRITES["codex/nod"]!.px);
    assert.notDeepEqual(SPRITES["codex/rest"]!.px, SPRITES["codex-sub/rest"]!.px);
    assert.notDeepEqual(SPRITES["claude/stand"]!.px, SPRITES["claude-sub/stand"]!.px);
    assert.notDeepEqual(SPRITES["codex/walk0"]!.px, SPRITES["codex/walk1"]!.px);
  });

  test("every sprite is well-formed", () => {
    for (const [name, s] of Object.entries(SPRITES)) {
      assert.equal(s.px.length, s.w * s.h, name);
      assert.ok(s.px.every((p) => p === null || /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(p)), name);
    }
  });

  test("the office background fills the room above the labels, with no holes", () => {
    const office = SPRITES["office"]!;
    assert.equal(office.w, WIDTH);
    assert.equal(ROOM_W, WIDTH);
    assert.equal(office.h, ROOM_H);
    assert.ok(ROOM_H < HEIGHT - 10, "room for the labels");
    assert.equal(WIDTH * 9, HEIGHT * 16, "16:9");
    assert.ok(office.px.every((p) => p !== null && p.length === 7));
    assert.ok(new Set(office.px).size > 80);
  });

  test("the background is one sprite, so a frame stays a short list", () => {
    for (const scene of [...MODES.map((m) => sceneOf(m)), withPeople(crowd(12))]) {
      const ops = art(scene, base);
      assert.equal(ops[0]!.kind === "sprite" && ops[0]!.name, "office");
      assert.ok(ops.length < (scene.people.length > 2 ? 400 : 120), `${scene.mode}: ${ops.length}`);
    }
  });

  test("the idle office does not move", () => {
    for (const s of [sceneOf("IDLE"), demoScene(18_000), withPeople(crowd(12, "idle"), 0, "IDLE"), withPeople([], 0, "IDLE")]) {
      for (const frame of [1, 5, 13]) {
        assert.deepEqual(art(s, { ...base, frame: 0 }), art(s, { ...base, frame }));
      }
    }
  });

  test("every sprite the scenes use exists", () => {
    const scenes = [...MODES.flatMap((m) => [sceneOf(m, "codex"), sceneOf(m, "claude")]), withPeople(crowd(12)), ...[2, 4.6, 6, 10, 14, 18].map((s) => demoScene(s * 1000))];
    for (const scene of scenes) {
      for (let frame = 0; frame < 12; frame += 1) {
        for (const op of art(scene, { ...base, frame })) {
          if (op.kind === "sprite") {
            const s = SPRITES[op.name];
            assert.ok(s, op.name);
            assert.equal(op.w, s.w);
            assert.equal(op.h, s.h);
          }
        }
      }
    }
  });
});
