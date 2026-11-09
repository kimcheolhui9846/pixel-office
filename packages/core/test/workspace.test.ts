import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_STATE,
  inWorkspace,
  normalizePath,
  officeUrl,
  reduce,
  scene,
  workspaceName,
  workspaceState,
  type AgentEvent,
  type OfficeState,
} from "../src/index.js";

describe("normalizePath", () => {
  test("one spelling for the same Windows folder", () => {
    const want = "c:/users/me/repo";
    for (const path of [
      "C:\\Users\\me\\repo",
      "c:/Users/me/repo",
      "C:\\Users\\me\\repo\\",
      "C:/Users//me///repo/",
      "/mnt/c/Users/me/repo",
      "/mnt/C/Users/me/repo/",
      "  C:\\Users\\me\\repo  ",
    ]) {
      assert.equal(normalizePath(path), want, path);
    }
  });

  test("drive roots keep their slash", () => {
    assert.equal(normalizePath("C:"), "c:/");
    assert.equal(normalizePath("C:\\"), "c:/");
    assert.equal(normalizePath("/mnt/d"), "d:/");
  });

  test("a Windows view into WSL is the Linux path", () => {
    assert.equal(normalizePath("\\\\wsl.localhost\\Ubuntu\\home\\me\\repo"), "/home/me/repo");
    assert.equal(normalizePath("\\\\wsl$\\Ubuntu-24.04\\home\\me\\repo\\"), "/home/me/repo");
    assert.equal(normalizePath("//wsl.localhost/Ubuntu"), "/");
  });

  test("Linux paths keep their case", () => {
    assert.equal(normalizePath("/home/Me/Repo/"), "/home/Me/Repo");
    assert.equal(normalizePath("/"), "/");
  });
});

describe("inWorkspace", () => {
  test("the folder itself and folders inside it", () => {
    assert.equal(inWorkspace("D:\\aaa\\pixel-office", "d:/aaa/pixel-office"), true);
    assert.equal(inWorkspace("D:\\aaa\\pixel-office\\packages\\cli", "D:\\aaa\\pixel-office"), true);
    assert.equal(inWorkspace("/mnt/d/aaa/pixel-office/docs", "D:\\aaa\\pixel-office"), true);
  });

  test("a sibling with the same prefix is outside", () => {
    assert.equal(inWorkspace("D:\\aaa\\pixel-office-old", "D:\\aaa\\pixel-office"), false);
    assert.equal(inWorkspace("D:\\aaa", "D:\\aaa\\pixel-office"), false);
    assert.equal(inWorkspace("/home/me/Repo", "/home/me/repo"), false);
  });

  test("a drive root contains the whole drive; empty never matches", () => {
    assert.equal(inWorkspace("C:\\Users\\me", "C:\\"), true);
    assert.equal(inWorkspace("D:\\x", "C:\\"), false);
    assert.equal(inWorkspace("C:\\x", "  "), false);
  });
});

describe("workspaceState and scene", () => {
  const NOW = 1_700_000_000_000;
  const ev = (agent: "codex" | "claude", sessionId: string, cwd: string, type: AgentEvent["type"], ts: number): AgentEvent => ({
    agent,
    sessionId,
    cwd,
    type,
    ts,
  });
  let state: OfficeState = { ...EMPTY_STATE, now: NOW };
  for (const e of [
    ev("codex", "c1", "D:\\aaa\\pixel-office", "start", NOW),
    ev("claude", "k1", "D:\\aaa\\pixel-office\\docs", "waiting", NOW + 1),
    ev("claude", "k2", "C:\\Users\\me\\.claude", "start", NOW + 2),
  ]) {
    state = reduce(state, e);
  }

  test("each office sees only its folder's agents", () => {
    const office = scene(workspaceState(state, "D:/aaa/pixel-office"));
    assert.deepEqual(office.desks, { codex: "working", claude: "waiting" });
    assert.equal(office.focus, "claude");
    const other = scene(workspaceState(state, "C:\\Users\\me\\.claude"));
    assert.deepEqual(other.desks, { codex: "idle", claude: "working" });
    assert.equal(other.mode, "CLAUDE_RUNNING");
    assert.equal(scene(workspaceState(state, "E:\\empty")).mode, "IDLE");
  });

  test("null keeps every session", () => {
    assert.equal(workspaceState(state, null), state);
  });
});

describe("workspaceName and officeUrl", () => {
  test("the last folder name", () => {
    assert.equal(workspaceName("D:\\aaa\\pixel-office\\"), "pixel-office");
    assert.equal(workspaceName("/home/me/repo"), "repo");
    assert.equal(workspaceName("C:\\"), "C:");
  });

  test("a readable address with one parameter", () => {
    assert.equal(officeUrl(47821, "D:\\aaa\\pixel-office"), "http://127.0.0.1:47821/?workspace=D:/aaa/pixel-office");
    const url = officeUrl(1, "C:\\Users\\Jane Doe\\a&b#c");
    assert.equal(url, "http://127.0.0.1:1/?workspace=C:/Users/Jane%20Doe/a%26b%23c");
    assert.equal(new URL(url).searchParams.get("workspace"), "C:/Users/Jane Doe/a&b#c");
    assert.ok(!url.slice(url.indexOf("?")).includes("&"), "no second parameter");
  });
});
