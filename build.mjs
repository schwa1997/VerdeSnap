// Bundles the app into dist/: main + preload for Electron, and the overlay/pin pages with
// everything Tesseract needs, so reading text works with no internet.
import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/web/tess/core", { recursive: true });

const shared = { bundle: true, logLevel: "warning", sourcemap: false };
await build({ ...shared, entryPoints: ["src/main.ts", "src/preload.ts"], outdir: "dist", platform: "node", format: "cjs", external: ["electron"] });
await build({ ...shared, entryPoints: ["src/web/overlay.ts", "src/web/pin.ts"], outdir: "dist/web", platform: "browser", format: "iife", target: "chrome130" });

for (const f of ["overlay.html", "pin.html", "style.css"]) cpSync(`src/web/${f}`, `dist/web/${f}`);
cpSync("assets/icon.png", "dist/icon.png");
cpSync("assets/tessdata", "dist/web/tess/lang", { recursive: true });
cpSync("node_modules/tesseract.js/dist/worker.min.js", "dist/web/tess/worker.min.js");
for (const f of readdirSync("node_modules/tesseract.js-core"))
  if (f.endsWith("-lstm.wasm.js")) cpSync(`node_modules/tesseract.js-core/${f}`, `dist/web/tess/core/${f}`);
