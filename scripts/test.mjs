// Runs `node --test` on every *.test.js under the given folder. Node 20's test runner does
// not expand glob patterns (Node 21 and later do), so the files are listed here.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "dist/test";
const files = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
  .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
  .sort();

if (files.length === 0) {
  console.error(`no *.test.js under ${root}`);
  process.exit(1);
}
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
