// Builds a .vsix that runs without this repository: the extension plus the built core, cli
// and ui packages and `ws`, copied into the extension's own node_modules (the repo's are
// workspace links, which a .vsix cannot carry). Run `npm run build` first.
//
//   npm run package -w packages/vscode    -> packages/vscode/pixel-office-<version>.vsix
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ext = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(ext, "..", "..");
const stage = join(ext, "dist", "package");
const require = createRequire(import.meta.url);

function need(path) {
  if (!existsSync(path)) {
    console.error(`없습니다: ${path}\n먼저 저장소 루트에서 \`npm run build\`를 실행하세요.`);
    process.exit(1);
  }
  return path;
}

/** Copies `files` (folders or files, relative to `from`) into `to`, `.js` and package.json only for folders. */
function copy(from, to, files) {
  for (const file of files) {
    cpSync(need(join(from, file)), join(to, file), {
      recursive: true,
      filter: (src) => !/\.(d\.ts|map|tsbuildinfo)$/.test(src),
    });
  }
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const pkg = JSON.parse(readFileSync(join(ext, "package.json"), "utf8"));
// the dependencies stay: vsce finds them with `npm list --production` in the copies below
delete pkg.devDependencies;
delete pkg.scripts;
writeFileSync(join(stage, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
copy(ext, stage, ["README.md", "dist/src"]);
cpSync(join(root, "LICENSE"), join(stage, "LICENSE"));

const modules = join(stage, "node_modules");
copy(join(root, "packages", "core"), join(modules, "@pixel-office", "core"), ["package.json", "dist/src"]);
copy(join(root, "packages", "cli"), join(modules, "@pixel-office", "cli"), ["package.json", "dist/src"]);
copy(join(root, "packages", "ui"), join(modules, "@pixel-office", "ui"), ["package.json", "dist/web"]);
const ws = dirname(require.resolve("ws/package.json", { paths: [join(root, "packages", "core")] }));
copy(ws, join(modules, "ws"), ["package.json", "index.js", "wrapper.mjs", "browser.js", "lib", "LICENSE"]);

// the stage holds only what ships; the file just tells vsce so
writeFileSync(join(stage, ".vscodeignore"), "# everything in this folder ships
");

const out = join(ext, `pixel-office-${pkg.version}.vsix`);
const vsce = join(dirname(require.resolve("@vscode/vsce/package.json", { paths: [root] })), "vsce");
const result = spawnSync(process.execPath, [vsce, "package", "--out", out], {
  cwd: stage,
  stdio: "inherit",
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
console.log(`만들었습니다: ${out}`);
