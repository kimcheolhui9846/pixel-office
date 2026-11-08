import assert from "node:assert/strict";
import { test } from "node:test";

import { backoffMs } from "../src/backoff.js";

test("backoff doubles from 1 s and stops at 30 s", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map(backoffMs),
    [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000],
  );
});

test("backoff stays capped for large attempt counts and is safe for bad input", () => {
  assert.equal(backoffMs(1_000), 30_000);
  assert.equal(backoffMs(-3), 1_000);
});
