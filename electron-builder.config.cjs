const fs = require("node:fs");
const path = require("node:path");

const extraResources = [];

const localElectronDist = path.resolve(__dirname, "node_modules/electron/dist");
const hasLocalElectron = fs.existsSync(localElectronDist);

for (const dir of ["同济-上册", "同济-下册内容", "library"]) {
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    extraResources.push({
      from: dir,
      to: dir === "library" ? "library" : `library/${dir}`,
    });
  }
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "io.github.mathmaster.app",
  productName: "MathMaster",
  copyright: "Copyright © 2026 MathMaster contributors",
  directories: {
    output: "release",
    buildResources: "build",
  },
  files: ["dist/**/*", "package.json"],
  asar: true,
  ...(hasLocalElectron ? { electronDist: localElectronDist } : {}),
  extraResources,
  mac: {
    target: ["dmg", "zip"],
    category: "public.app-category.education",
    icon: "build/icon.icns",
  },
  win: {
    target: ["nsis", "portable"],
    icon: "build/icon.ico",
  },
  linux: {
    target: ["AppImage", "deb"],
    category: "Education",
    icon: "build/icon.png",
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
};
