/**
 * The floor plan (step 9c): where the five work zones are, the seats in each zone, the
 * standing spots for a full zone, the door, and the aisles people walk along. Pure data and
 * pure functions, so seat assignment is tested in Node.
 *
 * The room is seen from behind the people: they sit facing the wall. Three zones stand
 * against the wall (back row) and two in the middle of the floor (front row):
 *
 *   door | plan 기획 | design 설계 | review 검토      <- back row, seats face the wall
 *   ---------------- middle aisle -----------------
 *   build 구현          | gap | run 작업             <- front row
 *   ---------------- front aisle ------------------
 */
import type { Person, Scene, SessionStatus, Zone } from "@pixel-office/core";

/** Logical canvas (16:9); the page scales it up by a whole number. */
export const WIDTH = 320;
export const HEIGHT = 180;
/** The room above the label bar. */
export const ROOM_W = WIDTH;
export const ROOM_H = 166;

export interface Point {
  x: number;
  y: number;
}

export type Row = "back" | "front";

export interface ZoneArea {
  zone: Zone;
  /** Korean name shown on the zone sign. */
  label: string;
  x: number;
  w: number;
  row: Row;
  /** Accent colour of the sign and the floor tape. */
  color: string;
}

/** Top of a seated person's 20 x 32 frame, per row. */
export const BACK_Y = 58;
export const FRONT_Y = 116;
/** Top of a walking person's frame in the aisles. */
export const AISLE_Y = 72;
export const FRONT_AISLE_Y = 132;
/** Left edge of the walkway between the two front-row zones. */
export const GAP_X = 152;
/** Where people come in and leave: standing in the open door. */
export const DOOR: Point = { x: 3, y: 17 };

export const ZONE_AREAS: Record<Zone, ZoneArea> = {
  plan: { zone: "plan", label: "기획", x: 24, w: 96, row: "back", color: "#f3d55b" },
  design: { zone: "design", label: "설계", x: 120, w: 98, row: "back", color: "#6fa8dc" },
  review: { zone: "review", label: "검토", x: 218, w: 100, row: "back", color: "#c792ea" },
  build: { zone: "build", label: "구현", x: 2, w: 150, row: "front", color: "#5ad17a" },
  run: { zone: "run", label: "작업", x: 172, w: 146, row: "front", color: "#f6b26b" },
};

/** Seats per zone (top-left of the person's frame). Furniture is drawn around them. */
export const SEATS: Record<Zone, readonly Point[]> = {
  plan: [34, 61, 88].map((x) => ({ x, y: BACK_Y })),
  design: [127, 157, 187].map((x) => ({ x, y: BACK_Y })),
  review: [226, 254, 282].map((x) => ({ x, y: BACK_Y })),
  build: [16, 66, 116].map((x) => ({ x, y: FRONT_Y })),
  run: [206, 246, 286].map((x) => ({ x, y: FRONT_Y })),
};

const STAND_STEP = 28;

/** Standing spots in the aisle in front of a zone, for when its seats are taken. */
export function standingSpot(zone: Zone, index: number): Point {
  const area = ZONE_AREAS[zone];
  const count = Math.max(1, Math.floor((area.w - 20) / STAND_STEP) + 1);
  const layer = Math.floor(index / count);
  const y = area.row === "back" ? AISLE_Y : FRONT_AISLE_Y;
  // later layers stand half a step to the side, so a crowd still shows every head
  const x = area.x + 2 + (index % count) * STAND_STEP + ((layer % 2) * STAND_STEP) / 2;
  return { x: Math.min(x, area.x + area.w - 20), y: y - (layer % 3) };
}

export interface Slot {
  zone: Zone;
  kind: "seat" | "stand";
  index: number;
}

export function sameSlot(a: Slot | undefined, b: Slot | undefined): boolean {
  return a !== undefined && b !== undefined && a.zone === b.zone && a.kind === b.kind && a.index === b.index;
}

export function spotOf(slot: Slot): Point {
  return slot.kind === "seat" ? SEATS[slot.zone][slot.index]! : standingSpot(slot.zone, slot.index);
}

/**
 * Gives everyone a place in their zone. Stable: a person who stays in the same zone keeps
 * their seat. People standing because their zone was full take a seat when one frees up.
 * Newcomers and people who changed zones take the lowest free seat, then the lowest free
 * standing spot. The order of `people` breaks ties, so the result never depends on timing.
 */
export function assignSeats(people: readonly Person[], previous: ReadonlyMap<string, Slot>): Map<string, Slot> {
  const result = new Map<string, Slot>();
  const seatsTaken = new Map<Zone, Set<number>>();
  const standsTaken = new Map<Zone, Set<number>>();
  const taken = (map: Map<Zone, Set<number>>, zone: Zone) => {
    let set = map.get(zone);
    if (!set) {
      set = new Set();
      map.set(zone, set);
    }
    return set;
  };
  const freeSeat = (zone: Zone) => {
    const used = taken(seatsTaken, zone);
    for (let i = 0; i < SEATS[zone].length; i += 1) {
      if (!used.has(i)) return i;
    }
    return -1;
  };
  const freeStand = (zone: Zone) => {
    const used = taken(standsTaken, zone);
    let i = 0;
    while (used.has(i)) i += 1;
    return i;
  };
  // 1. keep the seats of people who stay in their zone
  for (const person of people) {
    const before = previous.get(person.id);
    if (before && before.kind === "seat" && before.zone === person.zone && !taken(seatsTaken, person.zone).has(before.index)) {
      taken(seatsTaken, person.zone).add(before.index);
      result.set(person.id, before);
    }
  }
  // 2. people already standing in their zone sit down if they can, or keep their spot
  for (const person of people) {
    const before = previous.get(person.id);
    if (result.has(person.id) || !before || before.kind !== "stand" || before.zone !== person.zone) continue;
    const seat = freeSeat(person.zone);
    if (seat >= 0) {
      taken(seatsTaken, person.zone).add(seat);
      result.set(person.id, { zone: person.zone, kind: "seat", index: seat });
    } else if (!taken(standsTaken, person.zone).has(before.index)) {
      taken(standsTaken, person.zone).add(before.index);
      result.set(person.id, before);
    }
  }
  // 3. everyone else: newcomers, people who changed zone
  for (const person of people) {
    if (result.has(person.id)) continue;
    const seat = freeSeat(person.zone);
    if (seat >= 0) {
      taken(seatsTaken, person.zone).add(seat);
      result.set(person.id, { zone: person.zone, kind: "seat", index: seat });
    } else {
      const stand = freeStand(person.zone);
      taken(standsTaken, person.zone).add(stand);
      result.set(person.id, { zone: person.zone, kind: "stand", index: stand });
    }
  }
  return result;
}

const AGENTS = new Set(["codex", "claude"]);
const STATUSES = new Set<SessionStatus>(["idle", "working", "waiting", "alert", "success"]);
const ZONE_SET = new Set<string>(Object.keys(ZONE_AREAS));

/**
 * The people of a scene. A scene from an older server has no `people`: then there is one
 * Codex (구현) and one Claude (작업), as in the office before step 9c. Entries with an unknown
 * agent are dropped and unknown values fall back to safe ones, so the page never breaks.
 */
export function peopleOf(scene: Pick<Scene, "desks"> & Partial<Pick<Scene, "people">>): Person[] {
  if (!Array.isArray(scene.people)) {
    return [
      { id: "codex", agent: "codex", kind: "main", status: scene.desks.codex, zone: "build" },
      { id: "claude", agent: "claude", kind: "main", status: scene.desks.claude, zone: "run" },
    ];
  }
  const out: Person[] = [];
  const seen = new Set<string>();
  for (const p of scene.people as unknown[]) {
    const v = p as Partial<Person> | null;
    if (typeof v !== "object" || v === null || typeof v.id !== "string" || !AGENTS.has(String(v.agent)) || seen.has(v.id)) {
      continue;
    }
    seen.add(v.id);
    const person: Person = {
      id: v.id,
      agent: v.agent as Person["agent"],
      kind: v.kind === "sub" ? "sub" : "main",
      status: STATUSES.has(v.status as SessionStatus) ? (v.status as SessionStatus) : "idle",
      zone: ZONE_SET.has(String(v.zone)) ? (v.zone as Zone) : "build",
    };
    if (typeof v.role === "string") {
      person.role = v.role;
    }
    out.push(person);
  }
  return out;
}
