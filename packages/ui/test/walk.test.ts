import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Person, Zone } from "@pixel-office/core";

import { DOOR, GAP_X, SEATS } from "../src/floor.js";
import { actorsAt, moving, nextStage, position, route, WALK_MS } from "../src/walk.js";

const person = (id: string, zone: Zone): Person => ({ id, agent: "claude", kind: "main", status: "working", zone });

describe("walk tween", () => {
  test("a walk takes about a second", () => {
    assert.ok(WALK_MS >= 800 && WALK_MS <= 1200);
  });

  test("starts at the old place and ends at the new one", () => {
    const from = SEATS.plan[0]!;
    const to = SEATS.review[2]!;
    assert.deepEqual(position(from, to, 0), from);
    assert.deepEqual(position(from, to, 1), to);
    assert.deepEqual(position(from, to, 1.5), to);
    assert.deepEqual(position(from, to, -1), from);
  });

  test("the path runs along the aisles, straight or with corners", () => {
    for (const [a, b] of [
      [SEATS.plan[0]!, SEATS.review[2]!],
      [SEATS.build[0]!, SEATS.design[1]!],
      [DOOR, SEATS.run[2]!],
    ] as const) {
      const points = route(a, b);
      assert.deepEqual(points[0], a);
      assert.deepEqual(points.at(-1), b);
      for (let i = 1; i < points.length; i += 1) {
        const p = points[i - 1]!;
        const q = points[i]!;
        assert.ok(p.x === q.x || p.y === q.y, "every leg is horizontal or vertical");
      }
      // every point in between lies on the path
      for (const t of [0.1, 0.33, 0.5, 0.77, 0.9]) {
        const at = position(a, b, t);
        const on = points.slice(1).some((q, i) => {
          const p = points[i]!;
          const inX = at.x >= Math.min(p.x, q.x) && at.x <= Math.max(p.x, q.x);
          const inY = at.y >= Math.min(p.y, q.y) && at.y <= Math.max(p.y, q.y);
          return inX && inY && (p.x === q.x ? at.x === p.x : at.y === p.y);
        });
        assert.ok(on, JSON.stringify(at));
      }
    }
    // from the front row to the back row through the gap between 구현 and 작업
    assert.ok(route(SEATS.build[0]!, SEATS.design[0]!).some((p) => p.x === GAP_X));
  });
});

describe("stage", () => {
  test("when the page opens everyone is already seated", () => {
    const stage = nextStage(null, [person("a", "build"), person("b", "run")], 0, false);
    assert.equal(moving(stage, 0), false);
    assert.deepEqual(
      actorsAt(stage, 0).map((a) => [a.x, a.y, a.seated, a.walking]),
      [
        [SEATS.build[0]!.x, SEATS.build[0]!.y, true, false],
        [SEATS.run[0]!.x, SEATS.run[0]!.y, true, false],
      ],
    );
  });

  test("a zone change walks from the old seat to the new one in WALK_MS", () => {
    const s0 = nextStage(null, [person("a", "build")], 0, false);
    const s1 = nextStage(s0, [person("a", "run")], 1_000, false);
    const start = actorsAt(s1, 1_000)[0]!;
    assert.deepEqual([start.x, start.y, start.walking], [SEATS.build[0]!.x, SEATS.build[0]!.y, true]);
    assert.equal(moving(s1, 1_000 + WALK_MS / 2), true);
    const half = actorsAt(s1, 1_000 + WALK_MS / 2)[0]!;
    assert.ok(half.walking && !half.seated);
    // the next stage keeps the walk going
    const s2 = nextStage(s1, [person("a", "run")], 1_000 + WALK_MS / 2, false);
    assert.deepEqual(actorsAt(s2, 1_000 + WALK_MS / 2), [half]);
    const end = actorsAt(s2, 1_000 + WALK_MS)[0]!;
    assert.deepEqual([end.x, end.y, end.seated, end.walking], [SEATS.run[0]!.x, SEATS.run[0]!.y, true, false]);
    assert.equal(moving(s2, 1_000 + WALK_MS), false);
  });

  test("the walk cycle alternates two frames", () => {
    const s0 = nextStage(null, [person("a", "plan")], 0, false);
    const s1 = nextStage(s0, [person("a", "review")], 0, false);
    const steps = new Set([0, 130, 260, 390].map((t) => actorsAt(s1, t)[0]!.step));
    assert.deepEqual([...steps].sort(), [0, 1]);
  });

  test("newcomers walk in from the door, leavers walk out and disappear", () => {
    const s0 = nextStage(null, [person("a", "build")], 0, false);
    const s1 = nextStage(s0, [person("a", "build"), person("b", "review")], 100, false);
    const b = actorsAt(s1, 100).find((a) => a.person.id === "b")!;
    assert.deepEqual([b.x, b.y, b.walking], [DOOR.x, DOOR.y, true]);
    const s2 = nextStage(s1, [person("b", "review")], 2_000, false);
    const a = actorsAt(s2, 2_000).find((x) => x.person.id === "a")!;
    assert.deepEqual([a.x, a.y, a.walking], [SEATS.build[0]!.x, SEATS.build[0]!.y, true]);
    const atDoor = actorsAt(s2, 2_000 + WALK_MS - 1).find((x) => x.person.id === "a")!;
    assert.ok(Math.abs(atDoor.x - DOOR.x) + Math.abs(atDoor.y - DOOR.y) < 5);
    const s3 = nextStage(s2, [person("b", "review")], 2_000 + WALK_MS, false);
    assert.deepEqual(actorsAt(s3, 2_000 + WALK_MS).map((x) => x.person.id), ["b"]);
    assert.equal(moving(s3, 2_000 + WALK_MS), false);
  });

  test("a new destination mid-walk starts from where the person is", () => {
    const s0 = nextStage(null, [person("a", "plan")], 0, false);
    const s1 = nextStage(s0, [person("a", "run")], 0, false);
    const mid = actorsAt(s1, 400)[0]!;
    const s2 = nextStage(s1, [person("a", "review")], 400, false);
    const now = actorsAt(s2, 400)[0]!;
    assert.deepEqual([now.x, now.y], [mid.x, mid.y]);
  });

  test("reduced motion: nobody walks, everyone jumps to their place", () => {
    const s0 = nextStage(null, [person("a", "plan")], 0, true);
    const s1 = nextStage(s0, [person("a", "run"), person("b", "build")], 10, true);
    assert.equal(moving(s1, 10), false);
    assert.ok(actorsAt(s1, 10).every((a) => a.seated && !a.walking));
    const s2 = nextStage(s1, [person("b", "build")], 20, true);
    assert.deepEqual(actorsAt(s2, 20).map((a) => a.person.id), ["b"]);
  });
});
