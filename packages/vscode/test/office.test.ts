import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";

import { ensureServer, healthy, loadCore, messageHtml, officeHtml, ServerStartError, spawnServer } from "../src/office";

const root = mkdtempSync(join(tmpdir(), "pixel-office-vscode-"));
after(() => rmSync(root, { recursive: true, force: true }));

describe("officeHtml", () => {
  test("one iframe on the office address, only that origin allowed, no script", () => {
    const html = officeHtml("http://127.0.0.1:47821/?workspace=D%3A/a%26b", "Pixel Office · a&b");
    assert.match(html, /frame-src http:\/\/127\.0\.0\.1:47821;/);
    assert.match(html, /default-src 'none'/);
    assert.ok(html.includes('src="http://127.0.0.1:47821/?workspace=D%3A/a%26b"'));
    assert.ok(html.includes('title="Pixel Office · a&#38;b"'));
    assert.ok(!/<script/i.test(html));
  });

  test("quotes in the address cannot break out of the attribute", () => {
    const html = officeHtml('http://127.0.0.1:1/?workspace="><script>x</script>', "t");
    assert.ok(!html.includes("<script>"));
  });

  test("messages are escaped", () => {
    assert.ok(messageHtml("<b>").includes("&#60;b&#62;"));
  });
});

describe("ensureServer", () => {
  test("uses a running server and starts nothing", async () => {
    const { home } = await loadCore();
    const { startServer } = await import("@pixel-office/core/server");
    const dir = join(root, "running");
    const server = await startServer({ port: 0, home: dir });
    try {
      const result = await ensureServer({
        home: dir,
        homeModule: home,
        start: () => assert.fail("must not start a second server"),
      });
      assert.deepEqual(result, { port: server.port, started: false });
    } finally {
      await server.close();
    }
  });

  test("starts one when none answers, then finds it", async () => {
    const { home } = await loadCore();
    const { startServer } = await import("@pixel-office/core/server");
    const dir = join(root, "starting");
    let started: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      const result = await ensureServer({
        home: dir,
        homeModule: home,
        start: () => {
          void startServer({ port: 0, home: dir }).then((s) => (started = s));
        },
        pollMs: 50,
      });
      assert.equal(result.started, true);
      assert.equal(result.port, started?.port);
    } finally {
      await started?.close();
    }
  });

  test("gives up with a Korean message when nothing comes up", async () => {
    const { home } = await loadCore();
    await assert.rejects(
      ensureServer({ home: join(root, "never"), homeModule: home, start: () => {}, timeoutMs: 300, pollMs: 50 }),
      (error: Error) => error instanceof ServerStartError && error.message.includes("서버를 시작하지 못했습니다"),
    );
  });
});

describe("spawnServer", () => {
  test("the real CLI runs detached and answers /health", async () => {
    const { home } = await loadCore();
    const dir = join(root, "spawned");
    const cli = join(dirname(require.resolve("@pixel-office/cli/package.json")), "dist", "src", "cli.js");
    // a free port of our own, so a developer's server on 47821 is not touched
    const { createServer } = await import("node:net");
    const port = await new Promise<number>((done) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close(() => done(typeof address === "object" && address ? address.port : 0));
      });
    });
    const env = { ...process.env, PIXEL_OFFICE_HOME: dir };
    const result = await ensureServer({
      home: dir,
      homeModule: home,
      start: () => spawnServerOnPort(cli, port, env),
      pollMs: 100,
    });
    try {
      assert.equal(result.port, port);
      assert.equal(await healthy(port), true);
    } finally {
      const info = home.readServerInfo(dir);
      if (info) {
        process.kill(info.pid);
      }
    }
  });
});

/** `spawnServer` with `--port`, using this Node as the executable. */
function spawnServerOnPort(cli: string, port: number, env: NodeJS.ProcessEnv): void {
  spawnServer(process.execPath, `${cli}`, env, ["--port", String(port)]);
}
