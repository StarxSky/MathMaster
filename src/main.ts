import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
} from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AiRequest,
  AiResult,
  Annotation,
  AnnotationFile,
  PdfEntry,
  SummaryPayload,
} from "./shared/api";

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

const DEFAULT_DATA_DIR = path.join(os.homedir(), ".MathMaster");

function resolveDataRoot(root?: string): string {
  const value = typeof root === "string" ? root.trim() : "";
  return value ? path.resolve(value) : DEFAULT_DATA_DIR;
}

function ensureDataDirs(root?: string): string {
  const base = resolveDataRoot(root);
  fs.mkdirSync(path.join(base, "annotations"), { recursive: true });
  fs.mkdirSync(path.join(base, "PDFs"), { recursive: true });
  return base;
}

function safeBaseName(name: string): string {
  return (
    name
      .replace(/\.pdf$/i, "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .trim()
      .slice(0, 80) || "document"
  );
}

function annotationFilePath(root: string | undefined, documentPath: string): string {
  const base = ensureDataDirs(root);
  const hash = crypto
    .createHash("sha1")
    .update(documentPath)
    .digest("hex")
    .slice(0, 10);
  return path.join(
    base,
    "annotations",
    `${safeBaseName(path.basename(documentPath))}-${hash}.json`
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function markdownToHtml(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(4, heading[1].length + 1);
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      if (list !== "ol") {
        closeList();
        list = "ol";
        out.push("<ol>");
      }
      out.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
      continue;
    }
    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    if (unordered) {
      if (list !== "ul") {
        closeList();
        list = "ul";
        out.push("<ul>");
      }
      out.push(`<li>${inlineMarkdown(unordered[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

function buildSummaryHtml(payload: SummaryPayload): string {
  const annotations = payload.annotations
    .slice()
    .sort(
      (a, b) =>
        a.page - b.page || a.y - b.y || a.x - b.x || a.createdAt - b.createdAt
    );
  const rows = annotations
    .map((a, i) => {
      const note = a.note.trim();
      return `<div class="note">
        <div class="note-head"><span class="badge">${i + 1}</span>第 ${a.page} 页</div>
        <div class="note-body">${note ? inlineMarkdown(note) : "标记区域（未填写笔记）"}</div>
      </div>`;
    })
    .join("");
  const summary = payload.summary.trim()
    ? markdownToHtml(payload.summary)
    : '<p class="muted">尚未生成 AI 总结，此文档仅导出批注内容。</p>';
  const now = new Date();
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  @page { margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 28px; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; color: #1c2430; font-size: 13px; line-height: 1.7; }
  h1 { font-size: 24px; margin: 0 0 6px; }
  h2 { font-size: 18px; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #d9e0ea; }
  h3 { font-size: 15px; margin: 18px 0 8px; }
  h4 { font-size: 13.5px; margin: 14px 0 6px; }
  p { margin: 6px 0; }
  ul, ol { margin: 6px 0 6px 22px; padding: 0; }
  code { background: #f0f3f8; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .meta { color: #6b7686; font-size: 12px; margin-bottom: 18px; }
  .muted { color: #8b95a4; }
  .note { border: 1px solid #e1e7ef; border-radius: 10px; padding: 10px 12px; margin: 9px 0; background: #fbfcfe; break-inside: avoid; }
  .note-head { display: flex; align-items: center; gap: 8px; color: #4c6a92; font-weight: 600; font-size: 12.5px; }
  .badge { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; border-radius: 6px; background: #e8eef7; color: #35608f; font-size: 11px; }
  .note-body { margin-top: 4px; white-space: pre-wrap; }
  .notes { margin-top: 8px; }
</style>
</head>
<body>
  <h1>${escapeHtml(payload.title)}</h1>
  <div class="meta">来源：${escapeHtml(path.basename(payload.documentPath))} · 共 ${annotations.length} 条批注 · 生成于 ${now.toLocaleString("zh-CN")}</div>
  <h2>AI 知识总结</h2>
  ${summary}
  <h2>批注清单</h2>
  <div class="notes">${rows || '<p class="muted">暂无批注。</p>'}</div>
</body>
</html>`;
}

async function exportSummaryPdf(
  root: string | undefined,
  payload: SummaryPayload
): Promise<string> {
  const base = ensureDataDirs(root);
  const pdfDir = path.join(base, "PDFs");
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "-");
  const filePath = path.join(
    pdfDir,
    `${safeBaseName(payload.title)}-知识总结-${stamp}.pdf`
  );

  const html = buildSummaryHtml(payload);
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true },
  });
  try {
    await printWin.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(html)
    );
    const data = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    });
    await fs.promises.writeFile(filePath, data);
    return filePath;
  } finally {
    if (!printWin.isDestroyed()) printWin.destroy();
  }
}

async function callDeepSeek(request: AiRequest): Promise<AiResult> {
  const apiKey = request.apiKey.trim();
  if (!apiKey) return { ok: false, error: "请先在设置中填写 DeepSeek API Key" };
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: request.model?.trim() || "deepseek-chat",
        messages: request.messages,
        temperature: 0.3,
        stream: false,
      }),
    });
    const text = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* ignore non-json body */
    }
    if (!response.ok) {
      const message =
        data?.error?.message || data?.message || text.slice(0, 300);
      return {
        ok: false,
        error: `DeepSeek 请求失败 (${response.status})：${message}`,
      };
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return { ok: false, error: "DeepSeek 未返回有效内容" };
    }
    return { ok: true, content: content.trim() };
  } catch (err) {
    return {
      ok: false,
      error: `无法连接 DeepSeek：${err instanceof Error ? err.message : String(err)}`,
    };
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

  ipcMain.handle("data:defaultDir", () => DEFAULT_DATA_DIR);

  ipcMain.handle("data:ensure", (_event, root?: string) =>
    ensureDataDirs(root)
  );

  ipcMain.handle("dialog:pickDirectory", async (_event, defaultPath?: string) => {
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "选择 MathMaster 数据目录",
      defaultPath: defaultPath || DEFAULT_DATA_DIR,
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled || result.filePaths.length === 0
      ? null
      : result.filePaths[0];
  });

  ipcMain.handle(
    "annotations:load",
    async (_event, root: string | undefined, documentPath: string) => {
      const file = annotationFilePath(root, documentPath);
      try {
        const raw = await fs.promises.readFile(file, "utf8");
        const parsed = JSON.parse(raw) as AnnotationFile;
        if (!parsed || !Array.isArray(parsed.annotations)) return null;
        return parsed;
      } catch {
        return null;
      }
    }
  );

  ipcMain.handle(
    "annotations:save",
    async (
      _event,
      root: string | undefined,
      documentPath: string,
      documentName: string,
      annotations: Annotation[]
    ) => {
      const file = annotationFilePath(root, documentPath);
      const payload: AnnotationFile = {
        version: 1,
        document: { path: documentPath, name: documentName },
        annotations: Array.isArray(annotations) ? annotations : [],
        updatedAt: Date.now(),
      };
      await fs.promises.writeFile(
        file,
        JSON.stringify(payload, null, 2),
        "utf8"
      );
      return file;
    }
  );

  ipcMain.handle("ai:summarize", (_event, request: AiRequest) =>
    callDeepSeek(request)
  );

  ipcMain.handle(
    "summary:exportPdf",
    (_event, root: string | undefined, payload: SummaryPayload) =>
      exportSummaryPdf(root, payload)
  );

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
  ensureDataDirs();
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
