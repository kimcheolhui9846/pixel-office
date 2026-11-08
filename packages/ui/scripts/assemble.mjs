// Puts the browser files together in dist/web: index.html, the UI modules and the core
// modules. The page loads them as native ES modules through an import map, so there is no
// bundler. VS Code webviews and Orca's browser are both Chromium.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ui = dirname(dirname(fileURLToPath(import.meta.url)));
const web = join(ui, "dist", "web");
const core = join(ui, "..", "core", "dist", "src");

rmSync(web, { recursive: true, force: true });
mkdirSync(join(web, "app"), { recursive: true });
mkdirSync(join(web, "core"), { recursive: true });
cpSync(join(ui, "static", "index.html"), join(web, "index.html"));
for (const [from, to] of [
  [join(ui, "dist", "src"), join(web, "app")],
  [core, join(web, "core")],
]) {
  for (const name of readdirSync(from)) {
    if (name.endsWith(".js")) {
      cpSync(join(from, name), join(to, name));
    }
  }
}
