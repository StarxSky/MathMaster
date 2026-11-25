import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let child = null;
let rebuildTimer = null;

function runBuild() {
  return new Promise((resolve, reject) => {
    const build = spawn(process.execPath, ["scripts/build.mjs"], {
      cwd: root,
      stdio: "inherit",
    });
    build.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("build failed"))
    );
  });
}

function startElectron() {
  if (child) {
    child.kill();
    child = null;
  }
  child = spawn(
    path.join(root, "node_modules/.bin/electron"),
    [path.join(root, "dist/main.js")],
    { cwd: root, stdio: "inherit", env: process.env }
  );
}

await runBuild();
startElectron();

watch(path.join(root, "src"), { recursive: true }, () => {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(async () => {
    try {
      await runBuild();
      startElectron();
    } catch {
      /* keep previous build */
    }
  }, 250);
});
