import assert from "node:assert/strict";
import { test } from "node:test";

import { injectToken } from "@pixel-office/core/server";

import { readToken, TOKEN_META } from "../src/token.js";

const TOKEN = "ab".repeat(32);

test("reads the token the server injects", () => {
  const html = injectToken("<!doctype html><html><head><title>x</title></head></html>", TOKEN);
  assert.equal(readToken(html), TOKEN);
});

test("no token, a short token or a non-hex token gives undefined", () => {
  assert.equal(readToken("<html><head></head></html>"), undefined);
  assert.equal(readToken(`<meta name="${TOKEN_META}" content="abc" />`), undefined);
  assert.equal(readToken(`<meta name="${TOKEN_META}" content="${"zz".repeat(32)}" />`), undefined);
});
