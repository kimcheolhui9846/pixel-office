import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MAX_PEOPLE, type Person, type Zone, ZONES } from "@pixel-office/core";

import { assignSeats, peopleOf, ROOM_H, SEATS, type Slot, spotOf, standingSpot, WIDTH, ZONE_AREAS } from "../src/floor.js";
import { CHAR_H, CHAR_W } from "../src/sprites.js";

const person = (id: string, zone: Zone, extra: Partial<Person> = {}): Person => ({ id, agent: "codex", kind: "main", status: "working", zone, ...extra });

describe("floor plan", () => {
  test("five zones with three seats each, every seat inside its zone and the room", () => {
    assert.deepEqual(Object.keys(ZONE_AREAS).sort(), [...ZONES].sort());
    assert.deepEqual(ZONES.map((z) => ZONE_AREAS[z].label), ["기획", "설계", "구현", "작업", "검토"]);
    const all = new Set<string>();
    for (const zone of ZONES) {
      assert.equal(SEATS[zone].length, 3, zone);
      const area = ZONE_AREAS[zone];
      for (const seat of SEATS[zone]) {
        assert.ok(seat.x >= area.x && seat.x + CHAR_W <= area.x + area.w, `${zone} ${seat.x}`);
        assert.ok(seat.y >= 0 && seat.y + CHAR_H <= ROOM_H);
        all.add(`${seat.x},${seat.y}`);
      }
    }
    assert.equal(all.size, 15);
    assert.ok(all.size >= MAX_PEOPLE, "a seat for everyone when the zones are mixed");
  });

  test("standing spots stay in front of their zone and inside the room", () => {
    for (const zone of ZONES) {
      const area = ZONE_AREAS[zone];
      for (let i = 0; i < MAX_PEOPLE; i += 1) {
        const s = standingSpot(zone, i);
        assert.ok(s.x >= area.x && s.x + CHAR_W <= area.x + area.w, `${zone} ${i}`);
        assert.ok(s.y >= 0 && s.y + CHAR_H <= ROOM_H && s.x + CHAR_W <= WIDTH);
      }
    }
  });
});

describe("assignSeats", () => {
  test("a zone maps to a seat in that zone's area", () => {
    for (const zone of ZONES) {
      const slots = assignSeats([person("a", zone)], new Map());
      const slot = slots.get("a")!;
      assert.deepEqual(slot, { zone, kind: "seat", index: 0 });
      const p = spotOf(slot);
      const area = ZONE_AREAS[zone];
      assert.ok(p.x >= area.x && p.x < area.x + area.w);
    }
  });

  test("people keep their seat while others come and go", () => {
    const first = assignSeats([person("a", "build"), person("b", "build"), person("c", "build")], new Map());
    assert.deepEqual([0, 1, 2].map((i) => first.get("abc"[i]!)!.index), [0, 1, 2]);
    // a leaves: b and c stay where they are
    const second = assignSeats([person("b", "build"), person("c", "build")], first);
    assert.deepEqual(second.get("b"), first.get("b"));
    assert.deepEqual(second.get("c"), first.get("c"));
    // a newcomer takes the free seat, nobody else moves
    const third = assignSeats([person("b", "build"), person("c", "build"), person("d", "build")], second);
    assert.deepEqual(third.get("d"), { zone: "build", kind: "seat", index: 0 });
    assert.deepEqual(third.get("b"), first.get("b"));
    // the same input twice changes nothing
    assert.deepEqual(assignSeats([person("b", "build"), person("c", "build"), person("d", "build")], third), third);
  });

  test("changing zone frees the old seat and takes one in the new zone", () => {
    const first = assignSeats([person("a", "plan"), person("b", "plan")], new Map());
    const next = assignSeats([person("a", "run"), person("b", "plan")], first);
    assert.deepEqual(next.get("a"), { zone: "run", kind: "seat", index: 0 });
    assert.deepEqual(next.get("b"), first.get("b"));
  });

  test("a full zone has people stand nearby, and they sit when a seat frees up", () => {
    const four = ["a", "b", "c", "d"].map((id) => person(id, "review"));
    const first = assignSeats(four, new Map());
    assert.deepEqual(first.get("d"), { zone: "review", kind: "stand", index: 0 });
    const next = assignSeats(four.filter((p) => p.id !== "b"), first);
    assert.deepEqual(next.get("d"), first.get("b"));
    assert.deepEqual(next.get("a"), first.get("a"));
  });

  test("twelve people in one zone all get their own place", () => {
    const people = Array.from({ length: MAX_PEOPLE }, (_, i) => person(`p${i}`, "run"));
    const slots = assignSeats(people, new Map());
    const places = new Set([...slots.values()].map((s: Slot) => JSON.stringify(spotOf(s))));
    assert.equal(places.size, MAX_PEOPLE);
    assert.equal([...slots.values()].filter((s) => s.kind === "seat").length, 3);
  });
});

describe("peopleOf", () => {
  test("a scene without people (older server) gives one Codex at 구현 and one Claude at 작업", () => {
    const people = peopleOf({ desks: { codex: "working", claude: "alert" } });
    assert.deepEqual(
      people.map((p) => [p.agent, p.kind, p.status, p.zone]),
      [
        ["codex", "main", "working", "build"],
        ["claude", "main", "alert", "run"],
      ],
    );
  });

  test("bad entries are dropped or made safe", () => {
    const people = peopleOf({
      desks: { codex: "idle", claude: "idle" },
      people: [
        { id: "a", agent: "codex", kind: "main", status: "working", zone: "build" },
        { id: "a", agent: "codex", kind: "main", status: "working", zone: "build" },
        { id: "b", agent: "gpt", kind: "main", status: "working", zone: "build" },
        null,
        { id: "c", agent: "claude", kind: "sub", status: "dancing", zone: "kitchen", role: "Explore" },
      ] as unknown as Person[],
    });
    assert.deepEqual(people, [
      { id: "a", agent: "codex", kind: "main", status: "working", zone: "build" },
      { id: "c", agent: "claude", kind: "sub", status: "idle", zone: "build", role: "Explore" },
    ]);
  });
});
