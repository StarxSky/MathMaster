import type { PdfEntry } from "../shared/api";
import { PdfViewer, type LoadedInfo, type OutlineNode } from "./pdf";
import { icon } from "./icons";
import {
  applyBackground,
  applyTheme,
  applyWarm,
  DEFAULTS,
  loadDocs,
  loadJSON,
  loadSettings,
  LS,
  saveDocs,
  saveJSON,
  saveSettings,
  type Bookmark,
  type Settings,
  type TabInfo,
} from "./state";

declare global {
  interface Window {
    api: import("../shared/api").AppApi;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error("Missing element #" + id);
  return el as T;
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

const folderHue = (folder: string): number => {
  let h = 0;
  for (let i = 0; i < folder.length; i++) h = (h * 31 + folder.charCodeAt(i)) % 360;
  return h;
};

const baseName = (p: string) =>
  (p.split(/[\\/]/).pop() || "document").replace(/\.pdf$/i, "");

const CHAT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CHAT_URLS: Record<string, string> = {
  deepseek: "https://chat.deepseek.com/",
  chatgpt: "https://chatgpt.com/",
};

export class App {
  private settings: Settings = loadSettings();
  private docs = loadDocs();
  private tabs: TabInfo[] = [];
  private activePath: string | null = null;
  private currentLoadedPath: string | null = null;
  private library: PdfEntry[] = [];
  private bgImageData: string | null = null;
  private outline: OutlineNode[] = [];
  private tocEntries: { page: number; row: HTMLElement }[] = [];
  private tocFilter = "";
  private loadSeq = 0;
  private docsTimer = 0;
  private toastTimer = 0;
  private modalClose: (() => void) | null = null;
  private viewer!: PdfViewer;

  private pagesEl = $("pages");
  private viewerEl = $("viewer");
  private viewerShell = $("viewerShell");
  private emptyState = $("emptyState");
  private loadingEl = $("viewerLoading");
  private docTitle = $("docTitle");
  private vtDocTitle = $("vtDocTitle");
  private pageInput = $<HTMLInputElement>("pageInput");
  private pageTotal = $("pageTotal");
  private zoomLabel = $("zoomLabel");
  private bookmarkBtn = $("btnBookmark");
  private taskStatus = $("taskStatus");
  private tabsEl = $("tabs");
  private tocContent = $("tocContent");
  private marksContent = $("marksContent");
  private tocBody = $("tocBody");
  private tocFilterInput = $<HTMLInputElement>("tocFilter");
  private chatPanel = $("chatPanel");
  private tocPanel = $("tocPanel");
  private modalRoot = $("modalRoot");
  private toastEl = $("toast");

  async init() {
    document.body.classList.add(`platform-${window.api.platform}`);
    this.injectIcons();
    this.viewer = new PdfViewer(this.pagesEl, this.viewerEl, {
      onLoaded: (info) => this.handleLoaded(info),
      onPageChange: (page, total) => this.handlePageChange(page, total),
      onError: (message) => {
        console.error("[MathMaster] PDF error:", message);
        this.hideLoading();
        this.toast(message);
        if (this.viewer.getNumPages() === 0) this.showEmpty();
      },
    });

    window.addEventListener("error", (e) => {
      console.error("[MathMaster] uncaught", e.error ?? e.message);
    });
    window.addEventListener("unhandledrejection", (e) => {
      console.error("[MathMaster] unhandled rejection", e.reason);
    });

    this.applyAll();
    this.layoutPanels();
    this.bindTopbar();
    this.bindPanels();
    this.bindSidebar();
    this.bindViewer();
    this.bindTaskbar();
    this.bindChat();
    this.bindKeyboard();

    window.addEventListener("beforeunload", () => {
      saveDocs(this.docs);
      saveSettings(this.settings);
    });

    await this.loadBackground();
    await this.boot();
  }

  private injectIcons() {
    $("btnTheme").innerHTML = icon("sun");
    $("btnToc").innerHTML = icon("list");
    $("btnChat").innerHTML = icon("bot");
    $("btnWarm").innerHTML = icon("flame");
    $("btnSettings").innerHTML = icon("settings");
    $("btnLibrary").innerHTML = `${icon("book")}<span>书库</span>`;
    $("btnOpen").innerHTML = `${icon("folderOpen")}<span>打开</span>`;
    $("btnTocPin").innerHTML = icon("pin");
    $("btnTocClose").innerHTML = icon("x");
    $("btnChatPin").innerHTML = icon("pin");
    $("btnChatClose").innerHTML = icon("x");
    $("btnChatReload").innerHTML = icon("refresh");
    $("btnChatExternal").innerHTML = icon("external");
    $("btnPrevPage").innerHTML = icon("chevronLeft");
    $("btnNextPage").innerHTML = icon("chevronRight");
    $("btnZoomOut").innerHTML = icon("zoomOut");
    $("btnZoomIn").innerHTML = icon("zoomIn");
    $("btnFit").innerHTML = icon("fitWidth");
    $("btnRotate").innerHTML = icon("rotate");
    $("btnBookmark").innerHTML = icon("bookmark");
    $("btnNewTab").innerHTML = icon("plus");
    $("btnEmptyLibrary").innerHTML = `${icon("book")}<span>打开书库</span>`;
    $("btnEmptyOpen").innerHTML = `${icon("folderOpen")}<span>打开本地 PDF</span>`;
    $("searchIco").innerHTML = icon("search");
    $("emptyLogo").innerHTML = icon("book");
  }

  private applyAll() {
    applyTheme(this.settings.theme);
    applyWarm(this.settings.warm, this.settings.warmIntensity);
    applyBackground(this.settings, this.bgImageData);
    this.updateThemeButton();
    this.updateWarmButton();
  }

  private persistSettings() {
    saveSettings(this.settings);
  }

  private async loadBackground() {
    if (this.settings.bgImage) {
      this.bgImageData = await window.api.readImage(this.settings.bgImage);
    }
    applyBackground(this.settings, this.bgImageData);
  }

  // ---------------- topbar ----------------

  private bindTopbar() {
    $("btnTheme").addEventListener("click", () => {
      this.settings.theme = this.settings.theme === "dark" ? "light" : "dark";
      applyTheme(this.settings.theme);
      applyBackground(this.settings, this.bgImageData);
      applyWarm(this.settings.warm, this.settings.warmIntensity);
      this.updateThemeButton();
      this.persistSettings();
    });

    $("btnWarm").addEventListener("click", () => {
      this.settings.warm = !this.settings.warm;
      applyWarm(this.settings.warm, this.settings.warmIntensity);
      this.updateWarmButton();
      this.persistSettings();
      this.toast(this.settings.warm ? "已开启护眼暖色" : "已关闭护眼暖色");
    });

    $("btnToc").addEventListener("click", () =>
      this.togglePanel("toc")
    );
    $("btnChat").addEventListener("click", () =>
      this.togglePanel("chat")
    );
    $("btnLibrary").addEventListener("click", () => this.openLibrary());
    $("btnOpen").addEventListener("click", () => this.openFromDialog());
    $("btnSettings").addEventListener("click", () => this.openSettings());
  }

  private updateThemeButton() {
    const btn = $("btnTheme");
    const dark = this.settings.theme === "dark";
    btn.innerHTML = icon(dark ? "sun" : "moon");
    btn.title = dark ? "切换到浅色模式" : "切换到深色模式";
  }

  private updateWarmButton() {
    const btn = $("btnWarm");
    btn.classList.toggle("active", this.settings.warm);
    btn.title = this.settings.warm ? "关闭护眼暖色" : "开启护眼暖色";
  }

  // ---------------- panels ----------------

  private bindPanels() {
    $("btnTocPin").addEventListener("click", () => this.pinPanel("toc"));
    $("btnTocClose").addEventListener("click", () => this.closePanel("toc"));
    $("btnChatPin").addEventListener("click", () => this.pinPanel("chat"));
    $("btnChatClose").addEventListener("click", () => this.closePanel("chat"));
    this.bindResizer($("resizeChat"), "chat");
    this.bindResizer($("resizeToc"), "toc");
  }

  private togglePanel(which: "chat" | "toc") {
    const st = this.settings.panels[which];
    st.open = !st.open;
    this.layoutPanels();
    this.persistSettings();
    if (which === "chat" && st.open) this.ensureChat();
  }

  private closePanel(which: "chat" | "toc") {
    this.settings.panels[which].open = false;
    this.layoutPanels();
    this.persistSettings();
  }

  private pinPanel(which: "chat" | "toc") {
    const st = this.settings.panels[which];
    st.pinned = !st.pinned;
    this.layoutPanels();
    this.persistSettings();
  }

  private layoutPanels() {
    const order: Array<{ el: HTMLElement; key: "chat" | "toc" }> = [
      { el: this.chatPanel, key: "chat" },
      { el: this.tocPanel, key: "toc" },
    ];

    let flowWidth = 0;
    for (const { el, key } of order) {
      const st = this.settings.panels[key];
      el.style.display = st.open ? "" : "none";
      el.classList.toggle("open", st.open);
      el.classList.toggle("pinned", st.open && st.pinned);
      el.classList.toggle("overlay", st.open && !st.pinned);
      if (st.open) {
        el.style.width = `${st.width}px`;
        if (st.pinned) flowWidth += st.width;
      }
    }

    let overlayX = flowWidth;
    for (const { el, key } of order) {
      const st = this.settings.panels[key];
      if (st.open && !st.pinned) {
        overlayX += 8;
        el.style.left = `${overlayX}px`;
        overlayX += st.width;
      } else {
        el.style.left = "";
      }
    }

    $("btnToc").classList.toggle("active", this.settings.panels.toc.open);
    $("btnChat").classList.toggle("active", this.settings.panels.chat.open);
    $("btnTocPin").innerHTML = icon(
      this.settings.panels.toc.pinned ? "pin" : "pinOff"
    );
    $("btnTocPin").classList.toggle("active", this.settings.panels.toc.pinned);
    $("btnChatPin").innerHTML = icon(
      this.settings.panels.chat.pinned ? "pin" : "pinOff"
    );
    $("btnChatPin").classList.toggle("active", this.settings.panels.chat.pinned);
  }

  private bindResizer(handle: HTMLElement, which: "chat" | "toc") {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const st = this.settings.panels[which];
      const startX = e.clientX;
      const startW = st.width;
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        st.width = clamp(startW + (ev.clientX - startX), 240, 780);
        this.layoutPanels();
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        this.persistSettings();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  // ---------------- sidebar ----------------

  private bindSidebar() {
    const tabs = this.tocPanel.querySelectorAll<HTMLElement>(".sidebar-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.dataset.tab ?? "toc";
        tabs.forEach((t) => t.classList.toggle("active", t === tab));
        this.tocContent.classList.toggle("hidden", name !== "toc");
        this.marksContent.classList.toggle("hidden", name !== "marks");
        if (name === "marks") this.renderMarks();
      });
    });

    this.tocFilterInput.addEventListener("input", () => {
      this.tocFilter = this.tocFilterInput.value;
      this.renderToc();
    });
  }

  private renderToc() {
    const query = this.tocFilter.trim().toLowerCase();
    if (this.outline.length === 0) {
      this.tocEntries = [];
      this.renderPageGrid();
      return;
    }

    const prune = (nodes: OutlineNode[]): OutlineNode[] => {
      if (!query) return nodes;
      const result: OutlineNode[] = [];
      for (const node of nodes) {
        const children = prune(node.children);
        if (node.title.toLowerCase().includes(query) || children.length) {
          result.push({ ...node, children });
        }
      }
      return result;
    };

    const data = prune(this.outline);
    if (data.length === 0) {
      this.tocContent.replaceChildren(
        this.hint("没有匹配的目录项")
      );
      this.tocEntries = [];
      return;
    }

    this.tocEntries = [];
    const build = (nodes: OutlineNode[], depth: number): HTMLUListElement => {
      const ul = document.createElement("ul");
      ul.className = "toc-list";
      for (const node of nodes) {
        const li = document.createElement("li");
        const row = document.createElement("div");
        row.className = "toc-row";
        row.style.paddingLeft = `${depth * 13 + 6}px`;

        if (node.children.length) {
          const caret = document.createElement("button");
          caret.className = "toc-caret";
          caret.innerHTML = icon("chevronDown");
          caret.addEventListener("click", (e) => {
            e.stopPropagation();
            li.classList.toggle("collapsed");
            caret.innerHTML = icon(
              li.classList.contains("collapsed") ? "chevronRight" : "chevronDown"
            );
          });
          row.append(caret);
        } else {
          const spacer = document.createElement("span");
          spacer.className = "toc-caret spacer";
          row.append(spacer);
        }

        const title = document.createElement("span");
        title.className = "toc-title";
        title.textContent = node.title;
        row.append(title);

        if (node.page != null) {
          const page = document.createElement("span");
          page.className = "toc-page";
          page.textContent = String(node.page);
          row.append(page);
          this.tocEntries.push({ page: node.page, row });
        }

        row.addEventListener("click", () => {
          if (node.page != null) this.viewer.goToPage(node.page);
          else if (node.children.length) {
            li.classList.toggle("collapsed");
          }
        });

        li.append(row);
        if (node.children.length) {
          li.append(build(node.children, depth + 1));
        }
        ul.append(li);
      }
      return ul;
    };

    this.tocContent.replaceChildren(build(data, 0));
    this.highlightToc(this.viewer.getCurrentPage());
  }

  private renderPageGrid() {
    const total = this.viewer.getNumPages();
    const wrap = document.createElement("div");
    wrap.className = "toc-empty";
    const p = document.createElement("p");
    p.textContent =
      total > 0
        ? "该文档没有内置目录，可通过页码快速跳转："
        : "打开文档后这里会显示目录";
    wrap.append(p);
    if (total > 0) {
      const grid = document.createElement("div");
      grid.className = "page-grid";
      for (let i = 1; i <= total; i++) {
        const b = document.createElement("button");
        b.className = "page-chip";
        b.textContent = String(i);
        b.addEventListener("click", () => this.viewer.goToPage(i));
        grid.append(b);
      }
      wrap.append(grid);
    }
    this.tocContent.replaceChildren(wrap);
  }

  private highlightToc(page: number) {
    let best: HTMLElement | null = null;
    let bestPage = -1;
    for (const entry of this.tocEntries) {
      entry.row.classList.remove("active");
      if (entry.page <= page && entry.page >= bestPage) {
        bestPage = entry.page;
        best = entry.row;
      }
    }
    if (!best) return;
    best.classList.add("active");
    const rr = best.getBoundingClientRect();
    const br = this.tocBody.getBoundingClientRect();
    if (rr.top < br.top || rr.bottom > br.bottom) {
      best.scrollIntoView({ block: "nearest" });
    }
  }

  private renderMarks() {
    this.marksContent.replaceChildren();
    const path = this.activePath;
    if (!path) {
      this.marksContent.append(this.hint("打开文档后可添加书签"));
      return;
    }
    const meta = this.docs[path];
    const lastPage = meta?.lastPage ?? 1;
    const currentPage = this.viewer.getCurrentPage();

    const lastCard = document.createElement("button");
    lastCard.className = "last-read-card";
    lastCard.innerHTML = `${icon("clock")}<span>上次阅读到第 <b>${lastPage}</b> 页</span>`;
    lastCard.addEventListener("click", () => {
      this.viewer.goToPage(lastPage);
    });
    this.marksContent.append(lastCard);

    const header = document.createElement("div");
    header.className = "marks-head";
    const title = document.createElement("span");
    title.textContent = "书签";
    const add = document.createElement("button");
    add.className = "mini-btn";
    add.innerHTML = icon("plus");
    add.title = "将当前页添加为书签";
    add.addEventListener("click", () => this.toggleBookmark());
    header.append(title, add);
    this.marksContent.append(header);

    const marks = (meta?.bookmarks ?? [])
      .slice()
      .sort((a, b) => a.page - b.page);
    if (marks.length === 0) {
      this.marksContent.append(this.hint("还没有书签，点击右上角 ＋ 添加"));
    } else {
      const list = document.createElement("div");
      list.className = "marks-list";
      for (const bm of marks) {
        list.append(this.buildMarkRow(bm, currentPage));
      }
      this.marksContent.append(list);
    }
  }

  private buildMarkRow(bm: Bookmark, currentPage: number) {
    const row = document.createElement("div");
    row.className = "mark-row";
    if (bm.page === currentPage) row.classList.add("current");

    const main = document.createElement("button");
    main.className = "mark-main";
    main.innerHTML = `${icon("bookmarkFilled")}<span class="mark-label"></span><span class="mark-page">${bm.page}</span>`;
    const label = main.querySelector(".mark-label") as HTMLElement;
    label.textContent = bm.label;
    main.addEventListener("click", () => this.viewer.goToPage(bm.page));

    const del = document.createElement("button");
    del.className = "mini-btn mark-del";
    del.innerHTML = icon("trash");
    del.title = "删除书签";
    del.addEventListener("click", () => this.removeBookmark(bm.page));

    row.append(main, del);
    return row;
  }

  private toggleBookmark() {
    const path = this.activePath;
    if (!path) return;
    const page = this.viewer.getCurrentPage();
    const meta = this.docs[path] ?? {
      lastPage: page,
      bookmarks: [],
      updated: Date.now(),
    };
    const idx = meta.bookmarks.findIndex((b) => b.page === page);
    if (idx >= 0) {
      meta.bookmarks.splice(idx, 1);
      this.toast("已删除书签");
    } else {
      meta.bookmarks.push({
        page,
        label: `第 ${page} 页`,
        createdAt: Date.now(),
      });
      this.toast(`已添加书签：第 ${page} 页`);
    }
    meta.updated = Date.now();
    this.docs[path] = meta;
    this.commitDocs();
    this.renderMarks();
    this.updateBookmarkButton();
  }

  private removeBookmark(page: number) {
    const path = this.activePath;
    if (!path) return;
    const meta = this.docs[path];
    if (!meta) return;
    meta.bookmarks = meta.bookmarks.filter((b) => b.page !== page);
    meta.updated = Date.now();
    this.commitDocs();
    this.renderMarks();
    this.updateBookmarkButton();
  }

  private updateBookmarkButton() {
    const path = this.activePath;
    const page = this.viewer.getCurrentPage();
    const has =
      !!path &&
      (this.docs[path]?.bookmarks ?? []).some((b) => b.page === page);
    this.bookmarkBtn.innerHTML = icon(has ? "bookmarkFilled" : "bookmark");
    this.bookmarkBtn.classList.toggle("active", has);
    this.bookmarkBtn.title = has ? "删除本页书签" : "为本页添加书签";
  }

  private hint(text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "sidebar-hint";
    el.textContent = text;
    return el;
  }

  // ---------------- viewer ----------------

  private bindViewer() {
    $("btnPrevPage").addEventListener("click", () =>
      this.viewer.goToPage(this.viewer.getCurrentPage() - 1)
    );
    $("btnNextPage").addEventListener("click", () =>
      this.viewer.goToPage(this.viewer.getCurrentPage() + 1)
    );
    this.pageInput.addEventListener("change", () => {
      const n = parseInt(this.pageInput.value, 10);
      if (!Number.isNaN(n)) this.viewer.goToPage(n);
    });
    this.pageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        (e.target as HTMLInputElement).blur();
      }
    });
    $("btnZoomIn").addEventListener("click", () => {
      this.viewer.zoomBy(0.1);
      this.updateZoomLabel();
    });
    $("btnZoomOut").addEventListener("click", () => {
      this.viewer.zoomBy(-0.1);
      this.updateZoomLabel();
    });
    $("btnFit").addEventListener("click", () => {
      this.viewer.fitWidth();
      this.updateZoomLabel();
    });
    $("btnRotate").addEventListener("click", () => this.rotateCurrentPage());
    this.bookmarkBtn.addEventListener("click", () => this.toggleBookmark());
    $("btnEmptyLibrary").addEventListener("click", () => this.openLibrary());
    $("btnEmptyOpen").addEventListener("click", () => this.openFromDialog());
  }

  private updateZoomLabel() {
    this.zoomLabel.textContent = `${this.viewer.getZoomPercent()}%`;
  }

  private rotateCurrentPage() {
    if (this.viewer.getNumPages() === 0) return;
    const page = this.viewer.getCurrentPage();
    const angle = this.viewer.rotatePage(page);
    this.toast(`第 ${page} 页已旋转 ${angle}°`);
  }

  private showLoading() {
    this.loadingEl.classList.remove("hidden");
  }

  private hideLoading() {
    this.loadingEl.classList.add("hidden");
  }

  private handleLoaded(info: LoadedInfo) {
    console.info(
      `[MathMaster] loaded ${info.numPages} pages, ${info.outline.length} outline nodes`
    );
    this.outline = info.outline;
    const tab = this.tabs.find((t) => t.path === this.activePath);
    const title = info.title || tab?.name || "MathMaster";
    this.docTitle.textContent = title;
    this.vtDocTitle.textContent = title;
    this.pageTotal.textContent = String(info.numPages);
    this.emptyState.classList.add("hidden");
    this.hideLoading();
    this.renderToc();
    this.renderMarks();
    this.updateBookmarkButton();
    this.updateZoomLabel();
    this.updateTaskStatus();
  }

  private handlePageChange(page: number, total: number) {
    this.pageInput.value = String(page);
    this.pageTotal.textContent = String(total);
    this.updateBookmarkButton();
    this.highlightToc(page);
    this.updateTaskStatus();
    this.scheduleDocSave(page);
  }

  private updateTaskStatus() {
    if (!this.activePath) {
      this.taskStatus.textContent = "尚未打开文档";
      return;
    }
    const total = this.viewer.getNumPages() || 0;
    const page = this.viewer.getCurrentPage();
    this.taskStatus.textContent = `第 ${page} 页 / 共 ${total} 页`;
  }

  private scheduleDocSave(page: number) {
    const path = this.activePath;
    if (!path) return;
    const meta = this.docs[path] ?? {
      lastPage: 1,
      bookmarks: [],
      updated: Date.now(),
    };
    meta.lastPage = page;
    meta.updated = Date.now();
    this.docs[path] = meta;
    window.clearTimeout(this.docsTimer);
    this.docsTimer = window.setTimeout(() => this.commitDocs(), 500);
  }

  private commitDocs() {
    window.clearTimeout(this.docsTimer);
    saveDocs(this.docs);
  }

  // ---------------- chat ----------------

  private bindChat() {
    const provider = $<HTMLSelectElement>("chatProvider");
    provider.addEventListener("change", () => {
      const value = provider.value as Settings["chat"]["provider"];
      this.settings.chat.provider = value;
      this.persistSettings();
      if (value === "custom" && !this.settings.chat.customUrl) {
        void this.promptCustomUrl();
        return;
      }
      this.applyChatSrc(true);
    });

    $("btnChatReload").addEventListener("click", () => {
      const wv = this.chatWv();
      if (wv) wv.reload();
    });
    $("btnChatExternal").addEventListener("click", () => {
      void window.api.openExternal(this.chatUrl());
    });

    const wv = this.chatWv();
    if (wv) {
      wv.addEventListener("did-start-loading", () =>
        this.setChatHint("正在加载…")
      );
      wv.addEventListener("dom-ready", () => this.setChatHint(""));
      wv.addEventListener("did-stop-loading", () => this.setChatHint(""));
      wv.addEventListener("did-fail-load", () => {
        this.setChatHint("加载失败，可点击右上角用浏览器打开");
      });
    }

    provider.value = this.settings.chat.provider;
  }

  private chatWv(): any {
    return document.getElementById("chatWebview");
  }

  private chatUrl(): string {
    const p = this.settings.chat.provider;
    if (p === "custom") {
      return this.settings.chat.customUrl || CHAT_URLS.deepseek;
    }
    return CHAT_URLS[p] ?? CHAT_URLS.deepseek;
  }

  private applyChatSrc(force: boolean) {
    const wv = this.chatWv();
    if (!wv) return;
    const url = this.chatUrl();
    try {
      wv.setAttribute("useragent", CHAT_UA);
    } catch {
      /* ignore */
    }
    if (force || wv.getAttribute("src") !== url) {
      this.setChatHint("正在加载…");
      wv.setAttribute("src", url);
    }
  }

  private ensureChat() {
    this.applyChatSrc(false);
  }

  private initChat() {
    $<HTMLSelectElement>("chatProvider").value = this.settings.chat.provider;
    if (this.settings.panels.chat.open) this.applyChatSrc(true);
  }

  private setChatHint(text: string) {
    const hint = $("chatHint");
    hint.textContent = text;
    hint.classList.toggle("hidden", !text);
  }

  private promptCustomUrl() {
    let close: () => void = () => {};
    const content = this.buildPrompt(
      "请输入要内嵌的聊天网址",
      this.settings.chat.customUrl,
      (value) => {
        this.settings.chat.customUrl = value;
        this.settings.chat.provider = "custom";
        this.persistSettings();
        this.applyChatSrc(true);
        close();
      }
    );
    close = this.openModal(content);
  }

  // ---------------- tabs ----------------

  private bindTaskbar() {
    $("btnNewTab").addEventListener("click", () => this.openLibrary());
  }

  private renderTabs() {
    const frag = document.createDocumentFragment();
    for (const tab of this.tabs) {
      const chip = document.createElement("div");
      chip.className = "tab-chip";
      chip.classList.toggle("active", tab.path === this.activePath);
      chip.style.setProperty("--tab-hue", String(folderHue(tab.folder)));

      const main = document.createElement("button");
      main.className = "tab-main";
      const dot = document.createElement("span");
      dot.className = "tab-dot";
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = tab.name;
      label.title = tab.path;
      main.append(dot, label);
      main.addEventListener("click", () => void this.activateTab(tab.path));

      const close = document.createElement("button");
      close.className = "tab-close";
      close.innerHTML = icon("x");
      close.title = "关闭标签";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeTab(tab.path);
      });

      chip.addEventListener("auxclick", (e) => {
        if (e.button === 1) this.closeTab(tab.path);
      });

      chip.append(main, close);
      frag.append(chip);
    }
    this.tabsEl.replaceChildren(frag);
    this.updateTaskStatus();
  }

  private async boot() {
    this.library = await window.api.scanLibrary();
    const saved = loadJSON<{ tabs: TabInfo[]; active: string | null }>(
      LS.tabs,
      { tabs: [], active: null }
    );
    this.tabs = Array.isArray(saved.tabs)
      ? saved.tabs.filter((t) => t && typeof t.path === "string")
      : [];
    this.activePath = saved.active ?? null;

    if (this.tabs.length === 0 && this.library.length > 0) {
      const first = this.library[0];
      this.tabs = [{ path: first.path, name: first.name, folder: first.folder }];
      this.activePath = first.path;
    } else if (
      this.activePath &&
      !this.tabs.some((t) => t.path === this.activePath)
    ) {
      this.activePath = this.tabs[0]?.path ?? null;
    }

    this.renderTabs();
    this.saveTabs();
    this.initChat();

    if (!this.settings.panels.chat.open) this.setChatHint("");

    if (this.activePath) {
      await this.activateTab(this.activePath);
    } else {
      this.showEmpty();
    }
  }

  private showEmpty() {
    this.emptyState.classList.remove("hidden");
    this.hideLoading();
    this.docTitle.textContent = "MathMaster";
    this.vtDocTitle.textContent = "";
    this.pageTotal.textContent = "0";
    this.pageInput.value = "";
    this.taskStatus.textContent = "尚未打开文档";
    this.renderMarks();
  }

  private async activateTab(path: string) {
    const tab = this.tabs.find((t) => t.path === path);
    if (!tab) return;

    if (this.activePath && this.currentLoadedPath === this.activePath) {
      const page = this.viewer.getCurrentPage();
      this.scheduleDocSave(page);
    }

    this.activePath = path;
    this.renderTabs();
    this.saveTabs();
    this.updateTaskStatus();
    this.renderMarks();
    this.updateBookmarkButton();

    if (this.currentLoadedPath === path) return;

    const seq = ++this.loadSeq;
    this.showLoading();
    this.emptyState.classList.add("hidden");

    let bytes: Uint8Array;
    try {
      bytes = await window.api.readPdf(path);
    } catch {
      if (seq !== this.loadSeq) return;
      this.hideLoading();
      this.currentLoadedPath = null;
      this.showEmpty();
      this.toast("无法读取文件：" + tab.name);
      return;
    }
    if (seq !== this.loadSeq) return;

    const initial = this.docs[path]?.lastPage ?? 1;
    try {
      await this.viewer.load(bytes, initial);
    } catch {
      if (seq !== this.loadSeq) return;
      this.hideLoading();
      this.toast("加载 PDF 时出错");
      return;
    }
    if (seq !== this.loadSeq) return;
    this.currentLoadedPath = path;
    this.hideLoading();
    if (initial > 1) {
      this.toast(`已回到上次阅读的第 ${initial} 页`);
    }
  }

  private closeTab(path: string) {
    const idx = this.tabs.findIndex((t) => t.path === path);
    if (idx < 0) return;
    this.tabs.splice(idx, 1);
    const wasActive = this.activePath === path;
    if (wasActive) {
      this.currentLoadedPath = null;
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activePath = next ? next.path : null;
    }
    this.renderTabs();
    this.saveTabs();
    if (wasActive) {
      if (this.activePath) void this.activateTab(this.activePath);
      else {
        this.viewer.destroy();
        this.viewer = new PdfViewer(this.pagesEl, this.viewerEl, {
          onLoaded: (info) => this.handleLoaded(info),
          onPageChange: (page, total) => this.handlePageChange(page, total),
          onError: (message) => {
            this.hideLoading();
            this.toast(message);
          },
        });
        this.outline = [];
        this.tocEntries = [];
        this.showEmpty();
        this.renderToc();
      }
    }
  }

  private saveTabs() {
    saveJSON(LS.tabs, { tabs: this.tabs, active: this.activePath });
  }

  private async openFromDialog() {
    const paths = await window.api.openPdfDialog();
    for (const p of paths) {
      const tab: TabInfo = { path: p, name: baseName(p), folder: "本地文件" };
      if (!this.tabs.some((t) => t.path === p)) this.tabs.push(tab);
    }
    if (paths.length > 0) {
      this.renderTabs();
      this.saveTabs();
      await this.activateTab(paths[paths.length - 1]);
    }
  }

  // ---------------- library ----------------

  private openLibrary() {
    const content = document.createElement("div");
    content.className = "modal-inner";

    const head = document.createElement("div");
    head.className = "modal-head";
    const title = document.createElement("h3");
    title.textContent = "书库";
    const closeBtn = document.createElement("button");
    closeBtn.className = "mini-btn";
    closeBtn.innerHTML = icon("x");
    head.append(title, closeBtn);

    const search = document.createElement("div");
    search.className = "modal-search";
    search.innerHTML = icon("search");
    const searchInput = document.createElement("input");
    searchInput.placeholder = "搜索书名或章节…";
    search.append(searchInput);

    const body = document.createElement("div");
    body.className = "library-body";

    const render = (query: string) => {
      body.replaceChildren();
      const q = query.trim().toLowerCase();
      const groups = new Map<string, PdfEntry[]>();
      for (const entry of this.library) {
        if (
          q &&
          !entry.name.toLowerCase().includes(q) &&
          !entry.folder.toLowerCase().includes(q)
        )
          continue;
        const arr = groups.get(entry.folder) ?? [];
        arr.push(entry);
        groups.set(entry.folder, arr);
      }
      if (groups.size === 0) {
        const empty = document.createElement("div");
        empty.className = "sidebar-hint";
        empty.textContent = "没有找到 PDF 文件";
        body.append(empty);
        return;
      }
      for (const [folder, items] of groups) {
        const section = document.createElement("div");
        section.className = "library-group";
        const gh = document.createElement("div");
        gh.className = "library-group-head";
        gh.innerHTML = `${icon("folder")}<span></span>`;
        (gh.querySelector("span") as HTMLElement).textContent = folder;
        section.append(gh);

        const list = document.createElement("div");
        list.className = "library-list";
        for (const item of items) {
          const row = document.createElement("button");
          row.className = "library-item";
          const ic = document.createElement("span");
          ic.className = "lib-ico";
          ic.innerHTML = icon("file");
          const info = document.createElement("span");
          info.className = "lib-info";
          const nm = document.createElement("span");
          nm.className = "lib-name";
          nm.textContent = item.name;
          const meta = document.createElement("span");
          meta.className = "lib-meta";
          meta.textContent = `${(item.size / 1024 / 1024).toFixed(1)} MB`;
          info.append(nm, meta);
          row.append(ic, info);
          row.addEventListener("click", () => {
            const tab = {
              path: item.path,
              name: item.name,
              folder: item.folder,
            };
            if (!this.tabs.some((t) => t.path === item.path)) {
              this.tabs.push(tab);
            }
            this.renderTabs();
            this.saveTabs();
            close();
            void this.activateTab(item.path);
          });
          list.append(row);
        }
        section.append(list);
        body.append(section);
      }
    };

    render("");
    searchInput.addEventListener("input", () => render(searchInput.value));

    const foot = document.createElement("div");
    foot.className = "modal-foot";
    const openBtn = document.createElement("button");
    openBtn.className = "primary-btn";
    openBtn.innerHTML = `${icon("folderOpen")}<span>打开本地 PDF…</span>`;
    openBtn.addEventListener("click", () => {
      close();
      void this.openFromDialog();
    });
    const tip = document.createElement("span");
    tip.className = "foot-tip";
    tip.textContent = `共 ${this.library.length} 个文件`;
    foot.append(openBtn, tip);

    content.append(head, search, body, foot);
    const close = this.openModal(content, "lg");
    closeBtn.addEventListener("click", close);
    setTimeout(() => searchInput.focus(), 30);
  }

  // ---------------- settings ----------------

  private openSettings() {
    const content = document.createElement("div");
    content.className = "modal-inner settings";
    const s = this.settings;

    content.innerHTML = `
      <div class="modal-head">
        <h3>设置</h3>
        <button class="mini-btn" data-close>${icon("x")}</button>
      </div>
      <div class="modal-body settings-body">
        <section class="setting-group">
          <h4>外观主题</h4>
          <div class="seg" id="setTheme">
            <button data-theme="dark">深色</button>
            <button data-theme="light">浅色</button>
          </div>
        </section>
        <section class="setting-group">
          <h4>护眼阅读</h4>
          <label class="switch"><input type="checkbox" id="setWarm"> 启用暖色滤镜</label>
          <div class="range-row"><span>暖色强度</span><input type="range" id="setWarmIntensity" min="0" max="100" value="${s.warmIntensity}"><b id="warmVal">${s.warmIntensity}%</b></div>
        </section>
        <section class="setting-group">
          <h4>背景</h4>
          <div class="field">
            <span>背景颜色</span>
            <input type="color" id="setBgColor" value="${s.bgColor || (s.theme === "dark" ? "#0d0f14" : "#e9edf4")}">
            <button class="ghost-btn" id="setBgColorClear">跟随主题</button>
          </div>
          <div class="field">
            <span>背景图片</span>
            <button class="ghost-btn" id="setBgImage">${icon("image")}选择图片</button>
            <button class="ghost-btn" id="setBgImageClear">移除</button>
          </div>
          <div class="range-row"><span>图片透明度</span><input type="range" id="setBgImgOpacity" min="0" max="100" value="${s.bgImageOpacity}"><b id="imgOpVal">${s.bgImageOpacity}%</b></div>
          <div class="range-row"><span>界面不透明度</span><input type="range" id="setSurfaceOpacity" min="30" max="100" value="${s.surfaceOpacity}"><b id="surfVal">${s.surfaceOpacity}%</b></div>
          <label class="switch"><input type="checkbox" id="setBlur"> 背景模糊</label>
        </section>
        <section class="setting-group">
          <h4>AI 助手</h4>
          <div class="field">
            <span>服务</span>
            <select id="setChatProvider">
              <option value="deepseek">DeepSeek</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="custom">自定义网址</option>
            </select>
          </div>
          <div class="field">
            <span>自定义网址</span>
            <input type="text" id="setChatUrl" placeholder="https://..." value="${s.chat.customUrl.replace(/"/g, "&quot;")}">
          </div>
        </section>
        <section class="setting-group">
          <button class="ghost-btn danger" id="setReset">${icon("refresh")}恢复默认设置</button>
        </section>
      </div>
    `;

    const close = this.openModal(content);
    const q = <T extends HTMLElement = HTMLElement>(sel: string) =>
      content.querySelector(sel) as T;

    q('[data-close]').addEventListener("click", close);

    const themeSeg = q<HTMLDivElement>("#setTheme");
    const syncThemeSeg = () => {
      themeSeg
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.theme === this.settings.theme)
        );
    };
    syncThemeSeg();
    themeSeg
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          this.settings.theme = btn.dataset.theme as Settings["theme"];
          applyTheme(this.settings.theme);
          applyBackground(this.settings, this.bgImageData);
          this.updateThemeButton();
          this.persistSettings();
          syncThemeSeg();
        });
      });

    const warm = q<HTMLInputElement>("#setWarm");
    warm.checked = s.warm;
    warm.addEventListener("change", () => {
      this.settings.warm = warm.checked;
      applyWarm(this.settings.warm, this.settings.warmIntensity);
      this.updateWarmButton();
      this.persistSettings();
    });

    const warmInt = q<HTMLInputElement>("#setWarmIntensity");
    warmInt.addEventListener("input", () => {
      this.settings.warmIntensity = parseInt(warmInt.value, 10);
      q("#warmVal").textContent = `${this.settings.warmIntensity}%`;
      applyWarm(this.settings.warm, this.settings.warmIntensity);
      this.persistSettings();
    });

    const bgColor = q<HTMLInputElement>("#setBgColor");
    bgColor.addEventListener("input", () => {
      this.settings.bgColor = bgColor.value;
      applyBackground(this.settings, this.bgImageData);
      this.persistSettings();
    });
    q("#setBgColorClear").addEventListener("click", () => {
      this.settings.bgColor = "";
      applyBackground(this.settings, this.bgImageData);
      bgColor.value = this.settings.theme === "dark" ? "#0d0f14" : "#e9edf4";
      this.persistSettings();
    });
    q("#setBgImage").addEventListener("click", async () => {
      const picked = await window.api.pickImage();
      if (!picked) return;
      this.settings.bgImage = picked.path;
      this.bgImageData = picked.dataUrl;
      applyBackground(this.settings, this.bgImageData);
      this.persistSettings();
      this.toast("背景图片已更新");
    });
    q("#setBgImageClear").addEventListener("click", () => {
      this.settings.bgImage = "";
      this.bgImageData = null;
      applyBackground(this.settings, this.bgImageData);
      this.persistSettings();
    });

    const imgOp = q<HTMLInputElement>("#setBgImgOpacity");
    imgOp.addEventListener("input", () => {
      this.settings.bgImageOpacity = parseInt(imgOp.value, 10);
      q("#imgOpVal").textContent = `${this.settings.bgImageOpacity}%`;
      applyBackground(this.settings, this.bgImageData);
      this.persistSettings();
    });

    const surf = q<HTMLInputElement>("#setSurfaceOpacity");
    surf.addEventListener("input", () => {
      this.settings.surfaceOpacity = parseInt(surf.value, 10);
      q("#surfVal").textContent = `${this.settings.surfaceOpacity}%`;
      applyBackground(this.settings, this.bgImageData);
      this.persistSettings();
    });

    const blur = q<HTMLInputElement>("#setBlur");
    blur.checked = s.blur;
    blur.addEventListener("change", () => {
      this.settings.blur = blur.checked;
      applyBackground(this.settings, this.bgImageData);
      this.persistSettings();
    });

    const provider = q<HTMLSelectElement>("#setChatProvider");
    provider.value = s.chat.provider;
    provider.addEventListener("change", () => {
      this.settings.chat.provider = provider.value as Settings["chat"]["provider"];
      $<HTMLSelectElement>("chatProvider").value = provider.value;
      this.persistSettings();
      this.applyChatSrc(true);
    });

    const chatUrl = q<HTMLInputElement>("#setChatUrl");
    chatUrl.addEventListener("change", () => {
      this.settings.chat.customUrl = chatUrl.value.trim();
      this.persistSettings();
      if (this.settings.chat.provider === "custom") this.applyChatSrc(true);
    });

    q("#setReset").addEventListener("click", () => {
      this.settings = JSON.parse(JSON.stringify(DEFAULTS)) as Settings;
      this.persistSettings();
      this.applyAll();
      this.layoutPanels();
      this.initChat();
      $<HTMLSelectElement>("chatProvider").value = this.settings.chat.provider;
      this.toast("已恢复默认设置");
      close();
    });
  }

  // ---------------- modal / toast ----------------

  private buildPrompt(
    label: string,
    initial: string,
    onConfirm: (value: string) => void
  ): HTMLElement {
    const content = document.createElement("div");
    content.className = "modal-inner prompt-modal";
    const head = document.createElement("div");
    head.className = "modal-head";
    const title = document.createElement("h3");
    title.textContent = "设置";
    const closeBtn = document.createElement("button");
    closeBtn.className = "mini-btn";
    closeBtn.innerHTML = icon("x");
    head.append(title, closeBtn);

    const body = document.createElement("div");
    body.className = "modal-body";
    const fieldLabel = document.createElement("label");
    fieldLabel.className = "prompt-label";
    fieldLabel.textContent = label;
    const input = document.createElement("input");
    input.className = "text-input";
    input.value = initial;
    input.placeholder = "https://chat.deepseek.com/";
    body.append(fieldLabel, input);

    const foot = document.createElement("div");
    foot.className = "modal-foot";
    const ok = document.createElement("button");
    ok.className = "primary-btn";
    ok.textContent = "确定";
    foot.append(ok);

    content.append(head, body, foot);
    setTimeout(() => input.focus(), 30);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") ok.click();
    });
    ok.addEventListener("click", () => {
      const value = input.value.trim();
      if (!/^https?:\/\//i.test(value)) {
        this.toast("请输入以 http(s):// 开头的网址");
        return;
      }
      onConfirm(value);
    });
    closeBtn.addEventListener("click", () => this.closeModal());
    return content;
  }

  private openModal(
    content: HTMLElement,
    size: "md" | "lg" = "md"
  ): () => void {
    this.closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = `modal modal-${size}`;
    modal.append(content);
    backdrop.append(modal);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      if (this.modalClose === close) this.modalClose = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close();
    });
    document.addEventListener("keydown", onKey);
    this.modalRoot.append(backdrop);
    this.modalClose = close;
    return close;
  }

  private closeModal() {
    if (this.modalClose) {
      const c = this.modalClose;
      this.modalClose = null;
      c();
    }
  }

  private toast(message: string) {
    if (!message) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove("show");
    }, 2200);
  }

  // ---------------- keyboard ----------------

  private bindKeyboard() {
    window.addEventListener("keydown", (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void this.openFromDialog();
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        this.togglePanel("toc");
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        this.togglePanel("chat");
      } else if (mod && e.key === ",") {
        e.preventDefault();
        this.openSettings();
      } else if (mod && e.key.toLowerCase() === "w") {
        if (this.activePath) {
          e.preventDefault();
          this.closeTab(this.activePath);
        }
      } else if (!typing && !this.modalClose) {
        if (e.key === "+" || e.key === "=") {
          this.viewer.zoomBy(0.1);
          this.updateZoomLabel();
        } else if (e.key === "-") {
          this.viewer.zoomBy(-0.1);
          this.updateZoomLabel();
        } else if (e.key === "0") {
          this.viewer.fitWidth();
          this.updateZoomLabel();
        } else if (e.key.toLowerCase() === "r") {
          this.rotateCurrentPage();
        }
      }
    });
  }
}
