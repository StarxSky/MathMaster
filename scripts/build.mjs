import esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "renderer"), { recursive: true });

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
  absWorkingDir: root,
};

await esbuild.build({
  ...common,
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
});

await esbuild.build({
  ...common,
  entryPoints: ["src/preload.ts"],
  outfile: "dist/preload.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
});

await esbuild.build({
  ...common,
  entryPoints: ["src/renderer/renderer.ts"],
  outfile: "dist/renderer/renderer.js",
  platform: "browser",
  format: "iife",
  target: "chrome120",
});

await esbuild.build({
  ...common,
  entryPoints: ["node_modules/pdfjs-dist/build/pdf.worker.mjs"],
  outfile: "dist/renderer/pdf.worker.mjs",
  platform: "browser",
  format: "esm",
  target: "chrome120",
});

await cp(
  path.join(root, "src/renderer/index.html"),
  path.join(dist, "renderer/index.html")
);
await cp(
  path.join(root, "src/renderer/styles.css"),
  path.join(dist, "renderer/styles.css")
);

for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(
    path.join(root, "node_modules/pdfjs-dist", dir),
    path.join(dist, "renderer/pdfjs", dir),
    { recursive: true }
  );
}

console.log("build complete");
