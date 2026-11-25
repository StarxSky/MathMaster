import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PdfEntry } from "./shared/api";

app.setName("MathMaster");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const isMac = process.platform === "darwin";
const RENDERER_DIR = path.join(__dirname, "renderer");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
  ".icc": "application/octet-stream",
  ".pfb": "application/octet-stream",
};

function registerAppProtocol() {
  protocol.handle("app", async (request) => {
    try {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (!rel || rel === "/") rel = "/index.html";
      const target = path.normalize(path.join(RENDERER_DIR, rel));
      if (!target.startsWith(RENDERER_DIR + path.sep)) {
        return new Response("Forbidden", { status: 403 });
      }
      const data = await fs.promises.readFile(target);
      const type = MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream";
      return new Response(new Uint8Array(data), {
        headers: { "content-type": type, "cache-control": "no-cache" },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: "#101218",
    title: "MathMaster",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win?.show());

  win.webContents.on(
    "will-attach-webview",
    (_event, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      if (!params.partition || !params.partition.startsWith("persist:")) {
        params.partition = "persist:chat";
      }
    }
  );

  win.loadURL("app://app/index.html");

  win.on("closed", () => {
    win = null;
  });
}

function walkPdfs(dir: string, root: string, out: PdfEntry[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".") || name === "node_modules") continue;
    const full = path.join(dir, name);
    if (entry.isDirectory()) {
      if (name === "dist" || name === "out" || name === "release") continue;
      walkPdfs(full, root, out);
    } else if (entry.isFile() && name.toLowerCase().endsWith(".pdf")) {
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        /* ignore */
      }
      const rel = path.relative(root, dir);
      out.push({
        name: name.replace(/\.pdf$/i, ""),
        path: full,
        folder: rel === "" ? "书库" : rel,
        size,
      });
    }
  }
}

function addLibraryRoot(roots: Set<string>, candidate: string | undefined) {
  if (!candidate) return;
  try {
    const abs = path.resolve(candidate);
    if (!fs.existsSync(abs)) return;
    if (path.parse(abs).root === abs) return;
    roots.add(abs);
  } catch {
    /* ignore invalid path */
  }
}

function scanLibrary(): PdfEntry[] {
  const roots = new Set<string>();
  addLibraryRoot(roots, process.env.MATHMASTER_LIBRARY);
  if (app.isPackaged) {
    addLibraryRoot(roots, path.join(process.resourcesPath, "library"));
  } else {
    addLibraryRoot(roots, app.getAppPath());
    addLibraryRoot(roots, process.cwd());
    addLibraryRoot(roots, path.join(app.getAppPath(), "library"));
  }

  const found: PdfEntry[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const batch: PdfEntry[] = [];
    walkPdfs(root, root, batch);
    for (const item of batch) {
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      found.push(item);
    }
  }
  found.sort(
    (a, b) =>
      a.folder.localeCompare(b.folder, "zh-Hans-CN") ||
      a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true })
  );
  return found;
}

function toDataUrl(filePath: string): string | null {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".gif"
          ? "image/gif"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".svg"
              ? "image/svg+xml"
              : ext === ".bmp"
                ? "image/bmp"
                : "image/jpeg";
    const data = fs.readFileSync(filePath);
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

function registerIpc() {
  ipcMain.handle("library:scan", () => scanLibrary());

  ipcMain.handle("dialog:openPdf", async () => {
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      title: "打开 PDF",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("pdf:read", async (_event, filePath: string) => {
    const buf = await fs.promises.readFile(filePath);
    return new Uint8Array(buf);
  });

  ipcMain.handle("image:pick", async () => {
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "选择背景图片",
      properties: ["openFile"],
      filters: [
        {
          name: "图片",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"],
        },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const dataUrl = toDataUrl(filePath);
    if (!dataUrl) return null;
    return { path: filePath, dataUrl };
  });

  ipcMain.handle("image:read", (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return toDataUrl(filePath);
  });

  ipcMain.handle("shell:reveal", (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle("shell:openExternal", async (_event, url: string) => {
    if (typeof url === "string" && /^https?:/i.test(url)) {
      await shell.openExternal(url);
    }
  });
}

function buildMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    { role: "editMenu" },
    {
      label: "视图",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (contents.getType() === "webview") return;
    if (!url.startsWith("app://")) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
});

app.whenReady().then(() => {
  registerAppProtocol();
  registerIpc();
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
