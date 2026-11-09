import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEMO_LOOP_MS, demoScene, type Scene, type SceneMode } from "@pixel-office/core";

import { art, HEIGHT, type Op, WIDTH } from "../src/art.js";
import { ROOM_H, ROOM_W } from "../src/office.js";
import { CHAR_H, CHAR_W, POSES, SPRITES } from "../src/sprites.js";

const base = { frame: 0, reducedMotion: false, connected: true };

function sceneOf(mode: SceneMode, focus: Scene["focus"] = null): Scene {
  const desks: Scene["desks"] = { codex: "idle", claude: "idle" };
  if (mode === "CODEX_BUILDING") desks.codex = "working";
  if (mode === "CLAUDE_RUNNING") desks.claude = "working";
  if (mode === "CLAUDE_ALERT") desks[focus ?? "claude"] = "alert";
  if (mode === "SUCCESS") desks.claude = "success";
  return { mode, focus: focus ?? (mode === "IDLE" ? null : mode.startsWith("CODEX") ? "codex" : "claude"), desks };
}

const tags = (ops: Op[]) => new Set(ops.map((o) => o.tag).filter(Boolean));

describe("art", () => {
  test("each scene has its own marks", () => {
    assert.ok(tags(art(sceneOf("CODEX_BUILDING"), base)).has("codex-lamp-on"));
    assert.ok(tags(art(sceneOf("CODEX_BUILDING"), base)).has("codex-typing"));
    assert.ok(tags(art(sceneOf("CLAUDE_RUNNING"), base)).has("claude-matrix"));
    assert.ok(tags(art(sceneOf("CLAUDE_RUNNING"), base)).has("codex-coffee"));
    assert.ok(tags(art(sceneOf("CLAUDE_ALERT"), base)).has("claude-alarm-on"));
    assert.ok(tags(art(sceneOf("CLAUDE_ALERT"), base)).has("claude-head"));
    assert.ok(tags(art(sceneOf("SUCCESS"), base)).has("pass-flag"));
    assert.ok(tags(art(sceneOf("SUCCESS"), base)).has("confetti"));
    const idle = tags(art(sceneOf("IDLE"), base));
    for (const t of ["codex-lamp-on", "claude-matrix", "claude-alarm-on", "pass-flag", "confetti"]) {
      assert.ok(!idle.has(t), t);
    }
  });

  test("the five scenes all look different", () => {
    const modes: SceneMode[] = ["IDLE", "CODEX_BUILDING", "CLAUDE_RUNNING", "CLAUDE_ALERT", "SUCCESS"];
    const pictures = new Set(modes.map((m) => JSON.stringify(art(sceneOf(m), base))));
    assert.equal(pictures.size, 5);
  });

  test("during an alert the alarm and the red frame show on every frame", () => {
    const off = art(sceneOf("IDLE"), base).find((o) => o.tag === "claude-alarm-off")!;
    assert.ok(off.kind === "rect");
    const reds = new Set<string>();
    for (const frame of [0, 1, 2, 3]) {
      const ops = art(sceneOf("CLAUDE_ALERT"), { ...base, frame });
      const alarm = ops.find((o) => o.tag === "claude-alarm-on")!;
      assert.ok(alarm.kind === "rect" && alarm.color !== off.color, `frame ${frame}`);
      reds.add(alarm.color);
      assert.equal(ops.filter((o) => o.tag === "alert-glow").length, 4);
    }
    assert.equal(reds.size, 2, "the light blinks between two reds");
  });

  test("a codex alert lights the codex side, not the claude alarm", () => {
    const t = tags(art(sceneOf("CLAUDE_ALERT", "codex"), base));
    assert.ok(t.has("codex-alarm-on"));
    assert.ok(t.has("claude-alarm-off"));
  });

  test("animation changes frames, reduced motion does not", () => {
    const s = sceneOf("CLAUDE_RUNNING");
    assert.notDeepEqual(art(s, { ...base, frame: 1 }), art(s, { ...base, frame: 2 }));
    for (const mode of ["IDLE", "CODEX_BUILDING", "CLAUDE_RUNNING", "CLAUDE_ALERT", "SUCCESS"] as SceneMode[]) {
      for (const focus of ["codex", "claude"] as const) {
        const still = art(sceneOf(mode, focus), { ...base, frame: 0, reducedMotion: true });
        for (const frame of [1, 2, 3, 7]) {
          assert.deepEqual(art(sceneOf(mode, focus), { ...base, frame, reducedMotion: true }), still, `${mode} ${focus}`);
        }
      }
    }
  });

  test("the same input always draws the same picture", () => {
    const s = sceneOf("SUCCESS");
    assert.deepEqual(art(s, { ...base, frame: 3 }), art(s, { ...base, frame: 3 }));
  });

  test("a lost connection shows a banner", () => {
    assert.ok(tags(art(sceneOf("IDLE"), { ...base, connected: false })).has("disconnected"));
    assert.ok(!tags(art(sceneOf("IDLE"), base)).has("disconnected"));
  });

  test("everything is drawn inside the canvas", () => {
    for (const mode of ["IDLE", "CODEX_BUILDING", "CLAUDE_RUNNING", "CLAUDE_ALERT", "SUCCESS"] as SceneMode[]) {
      for (let frame = 0; frame < 30; frame += 1) {
        for (const op of art(sceneOf(mode), { ...base, frame, connected: false })) {
          assert.ok(op.x >= 0 && op.y >= 0 && op.x < WIDTH && op.y <= HEIGHT, `${mode} ${JSON.stringify(op)}`);
          if (op.kind !== "text") {
            assert.ok(op.x + op.w <= WIDTH && op.y + op.h <= HEIGHT, `${mode} ${JSON.stringify(op)}`);
          }
        }
      }
    }
  });
});

describe("demo", () => {
  test("the loop walks through the five scenes in order", () => {
    const at = (s: number) => demoScene(s * 1000).mode;
    assert.deepEqual(
      [at(2), at(6), at(10), at(14), at(18)],
      ["CODEX_BUILDING", "CLAUDE_RUNNING", "CLAUDE_ALERT", "SUCCESS", "IDLE"],
    );
  });

  test("the loop repeats", () => {
    assert.deepEqual(demoScene(6_000), demoScene(6_000 + 3 * DEMO_LOOP_MS));
  });

  test("scene boundaries fall where the script says", () => {
    assert.equal(demoScene(3_999).mode, "CODEX_BUILDING");
    assert.equal(demoScene(4_000).mode, "CLAUDE_RUNNING");
    assert.equal(demoScene(11_999).mode, "CLAUDE_ALERT");
    assert.equal(demoScene(12_000).mode, "CODEX_BUILDING"); // alert over, codex still works
    assert.equal(demoScene(12_500).mode, "SUCCESS");
    assert.equal(demoScene(16_500).mode, "IDLE");
  });
});

describe("sprites", () => {
  test("every pose of both agents is a 20 x 32 frame with real pixels", () => {
    for (const agent of ["codex", "claude"] as const) {
      for (const pose of POSES) {
        const s = SPRITES[`${agent}/${pose}`]!;
        assert.equal(s.w, CHAR_W);
        assert.equal(s.h, CHAR_H);
        assert.equal(s.px.length, CHAR_W * CHAR_H);
        assert.ok(s.px.filter((p) => p !== null).length > 200, `${agent}/${pose}`);
        assert.ok(s.px.every((p) => p === null || /^#[0-9a-f]{6}$/.test(p)));
      }
    }
  });

  test("poses differ, and the two agents look different", () => {
    for (const agent of ["codex", "claude"] as const) {
      const frames = new Set(POSES.filter((p) => p !== "nod").map((p) => JSON.stringify(SPRITES[`${agent}/${p}`]!.px)));
      assert.equal(frames.size, POSES.length - 1);
    }
    assert.notDeepEqual(SPRITES["codex/rest"]!.px, SPRITES["claude/rest"]!.px);
    assert.notDeepEqual(SPRITES["codex/rest"]!.px, SPRITES["codex/nod"]!.px);
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
    assert.ok(office.px.every((p) => p !== null && p.length === 7));
    // a real picture, not a flat fill
    assert.ok(new Set(office.px).size > 80);
  });

  test("the background is one sprite, so a frame stays a short list", () => {
    const modes: SceneMode[] = ["IDLE", "CODEX_BUILDING", "CLAUDE_RUNNING", "CLAUDE_ALERT", "SUCCESS"];
    for (const mode of modes) {
      const ops = art(sceneOf(mode), base);
      assert.equal(ops[0]!.kind === "sprite" && ops[0]!.name, "office");
      assert.ok(ops.length < 120, `${mode}: ${ops.length}`);
    }
  });

  test("the idle office does not move", () => {
    const s = sceneOf("IDLE");
    assert.deepEqual(art(s, { ...base, frame: 0 }), art(s, { ...base, frame: 5 }));
  });

  test("every sprite the scenes use exists", () => {
    for (const mode of ["IDLE", "CODEX_BUILDING", "CLAUDE_RUNNING", "CLAUDE_ALERT", "SUCCESS"] as SceneMode[]) {
      for (const focus of ["codex", "claude"] as const) {
        for (let frame = 0; frame < 12; frame += 1) {
          for (const op of art(sceneOf(mode, focus), { ...base, frame })) {
            if (op.kind === "sprite") {
              const s = SPRITES[op.name];
              assert.ok(s, op.name);
              assert.equal(op.w, s.w);
              assert.equal(op.h, s.h);
            }
          }
        }
      }
    }
  });

  test("motions per scene", () => {
    const t = (mode: SceneMode, frame = 0, focus?: "codex" | "claude") => tags(art(sceneOf(mode, focus), { ...base, frame }));
    assert.ok(t("IDLE").has("codex-chin") && t("IDLE").has("codex-blueprint") && t("IDLE").has("claude-fold"));
    assert.ok(t("CODEX_BUILDING", 0).has("codex-type0") && t("CODEX_BUILDING", 1).has("codex-type1"));
    assert.ok(t("CODEX_BUILDING").has("claude-fold"));
    assert.ok(t("CLAUDE_ALERT").has("codex-worried") && t("CLAUDE_ALERT").has("claude-head"));
    assert.ok(t("CLAUDE_ALERT", 0, "codex").has("codex-head"));
    assert.ok(t("SUCCESS", 0).has("codex-rest") && t("SUCCESS", 3).has("codex-nod"));
    assert.ok(t("SUCCESS").has("claude-cheer"));
    assert.ok(t("CLAUDE_ALERT").has("claude-log"));
    assert.ok(t("SUCCESS").has("claude-ok"));
    assert.ok(t("CLAUDE_ALERT", 0, "codex").has("codex-error"));
  });
});
