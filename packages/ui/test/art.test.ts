import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEMO_LOOP_MS, demoScene, type Scene, type SceneMode } from "@pixel-office/core";

import { art, HEIGHT, type Op, WIDTH } from "../src/art.js";

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
    for (const frame of [0, 1, 2, 3]) {
      const ops = art(sceneOf("CLAUDE_ALERT"), { ...base, frame });
      const alarm = ops.find((o) => o.tag === "claude-alarm-on")!;
      assert.notEqual(alarm.color, "#555560", `frame ${frame}`);
      assert.equal(ops.filter((o) => o.tag === "alert-glow").length, 4);
    }
  });

  test("a codex alert lights the codex side, not the claude alarm", () => {
    const t = tags(art(sceneOf("CLAUDE_ALERT", "codex"), base));
    assert.ok(t.has("codex-alarm-on"));
    assert.ok(t.has("claude-alarm-off"));
  });

  test("animation changes frames, reduced motion does not", () => {
    const s = sceneOf("CLAUDE_RUNNING");
    assert.notDeepEqual(art(s, { ...base, frame: 1 }), art(s, { ...base, frame: 2 }));
    assert.deepEqual(
      art(s, { ...base, frame: 1, reducedMotion: true }),
      art(s, { ...base, frame: 7, reducedMotion: true }),
    );
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
          if (op.kind === "rect") {
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
