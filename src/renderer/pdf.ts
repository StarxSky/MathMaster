import * as pdfjsLib from "pdfjs-dist";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdf.worker.mjs",
  document.baseURI
).href;

const ASSET_BASE = new URL("pdfjs/", document.baseURI).href;
const PAD = 24;
const GAP = 18;

export interface OutlineNode {
  title: string;
  page: number | null;
  children: OutlineNode[];
}

export interface LoadedInfo {
  numPages: number;
  outline: OutlineNode[];
  title: string;
}

export interface ViewerEvents {
  onLoaded(info: LoadedInfo): void;
  onPageChange(page: number, total: number): void;
  onError(message: string): void;
}

export class PdfViewer {
  private pdf: PDFDocumentProxy | null = null;
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private sizes: { w: number; h: number }[] = [];
  private rotations = new Map<number, number>();
  private tops: number[] = [];
  private els: HTMLElement[] = [];
  private rendered = new Set<number>();
  private pending = new Map<number, number>();
  private tasks = new Map<number, RenderTask>();
  private zoom = 1;
  private scale = 1;
  private token = 0;
  private raf = 0;
  private current = 1;
  private total = 0;

  constructor(
    private pagesEl: HTMLElement,
    private scrollEl: HTMLElement,
    private events: ViewerEvents
  ) {
    this.scrollEl.addEventListener("scroll", this.onScroll, { passive: true });
    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(this.scrollEl);
    this.resizeObserver = ro;
  }

  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer = 0;

  private onScroll = () => {
    this.updateCurrent(false);
    this.scheduleRender();
  };

  private onResize() {
    if (!this.pdf) return;
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.relayout(true);
    }, 140);
  }

  getCurrentPage(): number {
    return this.current;
  }

  getNumPages(): number {
    return this.total;
  }

  async load(data: Uint8Array, initialPage = 1): Promise<void> {
    this.reset();
    const token = this.token;

    const task = pdfjsLib.getDocument({
      data,
      cMapUrl: ASSET_BASE + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: ASSET_BASE + "standard_fonts/",
      wasmUrl: ASSET_BASE + "wasm/",
      iccUrl: ASSET_BASE + "iccs/",
    });
    this.loadingTask = task;

    let pdf: PDFDocumentProxy;
    try {
      pdf = await task.promise;
    } catch (err) {
      if (token === this.token) {
        this.events.onError(
          "无法加载该 PDF。文件可能已损坏或被加密。"
        );
      }
      return;
    }
    if (token !== this.token) {
      void task.destroy();
      return;
    }

    this.pdf = pdf;
    this.total = pdf.numPages;

    const sizes: { w: number; h: number }[] = new Array(this.total);
    const BATCH = 12;
    for (let start = 0; start < this.total; start += BATCH) {
      const end = Math.min(this.total, start + BATCH);
      await Promise.all(
        Array.from({ length: end - start }, (_, k) => {
          const index = start + k;
          return pdf.getPage(index + 1).then((page) => {
            const vp = page.getViewport({ scale: 1 });
            sizes[index] = { w: vp.width, h: vp.height };
          });
        })
      );
      if (token !== this.token) return;
    }
    this.sizes = sizes;

    let outline: OutlineNode[] = [];
    try {
      outline = await this.buildOutline(pdf);
    } catch {
      outline = [];
    }
    let title = "";
    try {
      const meta = await pdf.getMetadata();
      const info = meta.info as Record<string, unknown> | undefined;
      if (info && typeof info.Title === "string") title = info.Title.trim();
    } catch {
      /* ignore */
    }

    if (token !== this.token) return;

    this.buildPlaceholders();
    this.current = Math.min(Math.max(1, initialPage), this.total);
    this.relayout(false);

    this.events.onLoaded({ numPages: this.total, outline, title });
    this.events.onPageChange(this.current, this.total);

    requestAnimationFrame(() => {
      if (token !== this.token) return;
      this.scrollToPage(this.current, false);
      this.updateCurrent(true);
      this.renderVisible();
    });
  }

  private buildPlaceholders() {
    const frag = document.createDocumentFragment();
    this.els = this.sizes.map((_, i) => {
      const el = document.createElement("div");
      el.className = "page";
      el.dataset.page = String(i + 1);
      const label = document.createElement("span");
      label.className = "page-label";
      label.textContent = String(i + 1);
      el.append(label);
      frag.append(el);
      return el;
    });
    this.pagesEl.replaceChildren(frag);
  }

  private relayout(keepPage: boolean) {
    if (!this.pdf || this.sizes.length === 0) return;
    const prevPage = this.current;
    this.cancelRenders();
    this.rendered.clear();
    for (const el of this.els) {
      el.querySelector(".page-canvas-wrap")?.remove();
    }

    let maxW = 1;
    for (let i = 0; i < this.sizes.length; i++) {
      maxW = Math.max(maxW, this.dimsFor(i).w);
    }
    const available = Math.max(120, this.scrollEl.clientWidth - PAD * 2);
    const fit = available / maxW;
    this.scale = Math.max(0.05, fit * this.zoom);

    let cursor = PAD;
    this.tops = new Array(this.els.length);
    for (let i = 0; i < this.sizes.length; i++) {
      const size = this.dimsFor(i);
      const w = size.w * this.scale;
      const h = size.h * this.scale;
      const el = this.els[i];
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      this.tops[i] = cursor;
      cursor += h + GAP;
    }

    if (keepPage) {
      const page = prevPage;
      requestAnimationFrame(() => {
        this.scrollToPage(page, false);
        this.updateCurrent(true);
        this.renderVisible();
      });
    } else {
      this.renderVisible();
    }
  }

  private cancelRenders() {
    for (const task of this.tasks.values()) {
      try {
        task.cancel();
      } catch {
        /* ignore */
      }
    }
    this.tasks.clear();
  }

  private scheduleRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.renderVisible();
    });
  }

  private pageAt(y: number): number {
    const tops = this.tops;
    if (tops.length === 0) return 0;
    let lo = 0;
    let hi = tops.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] <= y) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  private updateCurrent(force: boolean) {
    if (!this.pdf) return;
    const probe =
      this.scrollEl.scrollTop + Math.min(this.scrollEl.clientHeight * 0.3, 180);
    const page = this.pageAt(probe) + 1;
    if (page !== this.current || force) {
      this.current = page;
      this.events.onPageChange(page, this.total);
    }
  }

  private renderVisible() {
    if (!this.pdf) return;
    const st = this.scrollEl.scrollTop;
    const vh = this.scrollEl.clientHeight;
    const first = this.pageAt(st + 1);
    const last = this.pageAt(st + vh);
    for (let i = first; i <= last; i++) this.renderPage(i);

    const lo = Math.max(0, first - 2);
    const hi = Math.min(this.total - 1, last + 2);
    for (const i of Array.from(this.rendered)) {
      if (i < lo || i > hi) this.unloadPage(i);
    }
  }

  private async renderPage(i: number) {
    if (!this.pdf || this.rendered.has(i)) return;
    if (this.pending.get(i) === this.token) return;
    const token = this.token;
    this.pending.set(i, token);
    let task: RenderTask | null = null;

    try {
      const page = await this.pdf.getPage(i + 1);
      if (token !== this.token) return;
      const rotation = (page.rotate + this.rotationDelta(i)) % 360;
      const viewport = page.getViewport({ scale: this.scale, rotation });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;

      task = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        background: "#ffffff",
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      this.tasks.set(i, task);
      await task.promise;
      if (token !== this.token) return;

      const el = this.els[i];
      if (!el) return;
      el.querySelector(".page-canvas-wrap")?.remove();
      const wrap = document.createElement("div");
      wrap.className = "page-canvas-wrap";
      wrap.append(canvas);
      el.append(wrap);
      this.rendered.add(i);
    } catch (err) {
      if (
        err instanceof Error &&
        /cancelled|canceled|destroyed/i.test(err.message)
      ) {
        return;
      }
    } finally {
      if (this.pending.get(i) === token) this.pending.delete(i);
      if (task && this.tasks.get(i) === task) this.tasks.delete(i);
    }
  }

  private unloadPage(i: number) {
    const el = this.els[i];
    if (el) el.querySelector(".page-canvas-wrap")?.remove();
    this.rendered.delete(i);
  }

  private scrollToPage(page: number, smooth: boolean) {
    const idx = Math.min(Math.max(1, page), this.total) - 1;
    const top = Math.max(0, this.tops[idx] - 6);
    if (smooth) {
      this.scrollEl.scrollTo({ top, behavior: "smooth" });
    } else {
      this.scrollEl.scrollTop = top;
    }
  }

  goToPage(page: number, smooth = true) {
    if (!this.pdf) return;
    const target = Math.min(Math.max(1, page), this.total);
    this.scrollToPage(target, smooth);
    this.current = target;
    this.events.onPageChange(target, this.total);
    if (!smooth) requestAnimationFrame(() => this.renderVisible());
  }

  setZoom(z: number) {
    const next = Math.min(3, Math.max(0.4, z));
    if (Math.abs(next - this.zoom) < 0.001) return;
    this.zoom = next;
    this.relayout(true);
  }

  zoomBy(delta: number) {
    this.setZoom(this.zoom + delta);
  }

  fitWidth() {
    this.zoom = 1;
    this.relayout(true);
  }

  getZoomPercent(): number {
    return Math.round(this.zoom * 100);
  }

  private rotationDelta(i: number): number {
    return this.rotations.get(i) ?? 0;
  }

  private dimsFor(i: number): { w: number; h: number } {
    const size = this.sizes[i] ?? { w: 1, h: 1 };
    return this.rotationDelta(i) % 180 === 0
      ? size
      : { w: size.h, h: size.w };
  }

  rotatePage(page = this.current): number {
    if (!this.pdf) return 0;
    const i = Math.min(Math.max(1, page), this.total) - 1;
    const delta = (this.rotationDelta(i) + 90) % 360;
    this.rotations.set(i, delta);
    this.relayout(true);
    return delta;
  }

  getPageRotation(page = this.current): number {
    return this.rotationDelta(Math.min(Math.max(1, page), this.total) - 1);
  }

  private reset() {
    this.token++;
    this.cancelRenders();
    this.rendered.clear();
    this.pending.clear();
    if (this.loadingTask) {
      void this.loadingTask.destroy();
      this.loadingTask = null;
    }
    this.pdf = null;
    this.pagesEl.replaceChildren();
    this.els = [];
    this.tops = [];
    this.sizes = [];
    this.rotations.clear();
    this.total = 0;
    this.current = 1;
    this.zoom = 1;
  }

  destroy() {
    this.reset();
    this.scrollEl.removeEventListener("scroll", this.onScroll);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.pagesEl.replaceChildren();
  }

  private async buildOutline(pdf: PDFDocumentProxy): Promise<OutlineNode[]> {
    const raw = await pdf.getOutline();
    if (!raw || raw.length === 0) return [];

    const resolvePage = async (dest: unknown): Promise<number | null> => {
      try {
        let target = dest;
        if (typeof target === "string") {
          target = await pdf.getDestination(target);
        }
        if (Array.isArray(target) && target.length > 0) {
          const ref = target[0];
          const index = await pdf.getPageIndex(ref as never);
          if (typeof index === "number" && index >= 0) return index + 1;
        }
      } catch {
        /* ignore broken destination */
      }
      return null;
    };

    const walk = async (
      items: typeof raw
    ): Promise<OutlineNode[]> => {
      const result: OutlineNode[] = [];
      for (const item of items) {
        result.push({
          title: item.title?.trim() || "未命名",
          page: await resolvePage(item.dest),
          children:
            item.items && item.items.length ? await walk(item.items) : [],
        });
      }
      return result;
    };

    return walk(raw);
  }
}
