/**
 * Walking (step 9c): who stands where at a given moment. Pure functions of the previous
 * stage, the people of the scene and the clock, so the page only keeps one `Stage` and the
 * tests can call everything with made-up times.
 *
 * When a person's place changes they walk there in `WALK_MS`, along the aisles: down (or
 * up) to the aisle of their row, along it, through the gap between the front-row zones when
 * they change rows, and up to the new place. Newcomers walk in from the door, people who
 * leave walk out to it. With reduced motion everyone jumps straight to their place.
 */
import type { Person } from "@pixel-office/core";

import {
  AISLE_Y,
  assignSeats,
  DOOR,
  FRONT_AISLE_Y,
  GAP_X,
  type Point,
  sameSlot,
  type Slot,
  spotOf,
} from "./floor.js";

/** How long one walk takes, whatever the distance. */
export const WALK_MS = 1000;
/** Steps per second of the two-frame walk cycle. */
const STEPS_PER_S = 8;

const FRONT_FROM = 100;

function aisleOf(p: Point): number {
  return p.y >= FRONT_FROM ? FRONT_AISLE_Y : AISLE_Y;
}

/** The corners of the path from `from` to `to` (both ends included, no repeats). */
export function route(from: Point, to: Point): Point[] {
  const a1 = aisleOf(from);
  const a2 = aisleOf(to);
  const points: Point[] =
    a1 === a2
      ? [from, { x: from.x, y: a1 }, { x: to.x, y: a1 }, to]
      : [from, { x: from.x, y: a1 }, { x: GAP_X, y: a1 }, { x: GAP_X, y: a2 }, { x: to.x, y: a2 }, to];
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
}

/** Where a walker is at `t` (0 = start, 1 = there), in whole pixels along the route. */
export function position(from: Point, to: Point, t: number): Point {
  const points = route(from, to);
  const legs = points.slice(1).map((p, i) => Math.abs(p.x - points[i]!.x) + Math.abs(p.y - points[i]!.y));
  const total = legs.reduce((a, b) => a + b, 0);
  if (total === 0 || t >= 1) return { x: to.x, y: to.y };
  if (t <= 0) return { x: from.x, y: from.y };
  let left = total * t;
  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i]!;
    if (left <= leg) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const k = leg === 0 ? 0 : left / leg;
      return { x: Math.round(a.x + (b.x - a.x) * k), y: Math.round(a.y + (b.y - a.y) * k) };
    }
    left -= leg;
  }
  return { x: to.x, y: to.y };
}

export interface Walk {
  from: Point;
  to: Point;
  start: number;
}

export interface Stage {
  /** Everyone in the scene, in scene order. */
  people: Map<string, Person>;
  slots: Map<string, Slot>;
  walks: Map<string, Walk>;
  /** People who left the scene and are walking out of the door. */
  leavers: { person: Person; walk: Walk }[];
}

/** One person to draw: where, sitting or standing, and the walk cycle frame. */
export interface Actor {
  person: Person;
  x: number;
  y: number;
  seated: boolean;
  walking: boolean;
  step: 0 | 1;
}

function progress(walk: Walk, now: number): number {
  return Math.min(1, Math.max(0, (now - walk.start) / WALK_MS));
}

function active(walk: Walk | undefined, now: number): walk is Walk {
  return walk !== undefined && now - walk.start < WALK_MS;
}

function here(stage: Stage, id: string, now: number): Point {
  const walk = stage.walks.get(id);
  if (active(walk, now)) return position(walk.from, walk.to, progress(walk, now));
  const slot = stage.slots.get(id);
  return slot ? spotOf(slot) : DOOR;
}

/**
 * The next stage. `previous` null means the page just opened: everyone is already in
 * place. `instant` (reduced motion) skips every walk.
 */
export function nextStage(previous: Stage | null, people: readonly Person[], now: number, instant: boolean): Stage {
  const slots = assignSeats(people, previous?.slots ?? new Map());
  const walks = new Map<string, Walk>();
  const byId = new Map<string, Person>();
  for (const person of people) {
    byId.set(person.id, person);
    if (previous === null || instant) continue;
    const slot = slots.get(person.id)!;
    const before = previous.slots.get(person.id);
    const old = previous.walks.get(person.id);
    if (before === undefined) {
      walks.set(person.id, { from: DOOR, to: spotOf(slot), start: now });
    } else if (!sameSlot(before, slot)) {
      walks.set(person.id, { from: here(previous, person.id, now), to: spotOf(slot), start: now });
    } else if (active(old, now)) {
      walks.set(person.id, old);
    }
  }
  const leavers: Stage["leavers"] = [];
  if (previous !== null && !instant) {
    for (const leaver of previous.leavers) {
      if (active(leaver.walk, now) && !byId.has(leaver.person.id)) leavers.push(leaver);
    }
    for (const [id, person] of previous.people) {
      if (!byId.has(id)) {
        leavers.push({ person, walk: { from: here(previous, id, now), to: DOOR, start: now } });
      }
    }
  }
  return { people: byId, slots, walks, leavers };
}

/** True while someone is walking: the page draws faster then. */
export function moving(stage: Stage, now: number): boolean {
  return stage.leavers.some((l) => active(l.walk, now)) || [...stage.walks.values()].some((w) => active(w, now));
}

function stepOf(walk: Walk, now: number): 0 | 1 {
  return (Math.floor(((now - walk.start) * STEPS_PER_S) / 1000) % 2) as 0 | 1;
}

/** Everyone to draw at `now`, in scene order, then the people leaving. */
export function actorsAt(stage: Stage, now: number): Actor[] {
  const out: Actor[] = [];
  for (const [id, person] of stage.people) {
    const walk = stage.walks.get(id);
    const slot = stage.slots.get(id)!;
    if (active(walk, now)) {
      const p = position(walk.from, walk.to, progress(walk, now));
      out.push({ person, x: p.x, y: p.y, seated: false, walking: true, step: stepOf(walk, now) });
    } else {
      const p = spotOf(slot);
      out.push({ person, x: p.x, y: p.y, seated: slot.kind === "seat", walking: false, step: 0 });
    }
  }
  for (const { person, walk } of stage.leavers) {
    if (!active(walk, now)) continue;
    const p = position(walk.from, walk.to, progress(walk, now));
    out.push({ person, x: p.x, y: p.y, seated: false, walking: true, step: stepOf(walk, now) });
  }
  return out;
}
