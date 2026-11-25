export type Theme = "dark" | "light";
export type ChatProvider = "deepseek" | "chatgpt" | "custom";

export interface PanelState {
  open: boolean;
  pinned: boolean;
  width: number;
}

export interface Settings {
  theme: Theme;
  warm: boolean;
  warmIntensity: number;
  bgColor: string;
  bgImage: string;
  bgImageOpacity: number;
  surfaceOpacity: number;
  blur: boolean;
  chat: {
    provider: ChatProvider;
    customUrl: string;
  };
  panels: {
    chat: PanelState;
    toc: PanelState;
  };
}

export interface Bookmark {
  page: number;
  label: string;
  createdAt: number;
}

export interface DocMeta {
  lastPage: number;
  bookmarks: Bookmark[];
  updated: number;
}

export interface TabInfo {
  path: string;
  name: string;
  folder: string;
}

export const LS = {
  settings: "mm.settings.v1",
  tabs: "mm.tabs.v1",
  docs: "mm.docs.v1",
} as const;

export const DEFAULTS: Settings = {
  theme: "dark",
  warm: false,
  warmIntensity: 38,
  bgColor: "",
  bgImage: "",
  bgImageOpacity: 100,
  surfaceOpacity: 90,
  blur: true,
  chat: {
    provider: "deepseek",
    customUrl: "",
  },
  panels: {
    chat: { open: false, pinned: false, width: 392 },
    toc: { open: true, pinned: true, width: 304 },
  },
};

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    if (parsed == null) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
}

export function loadSettings(): Settings {
  const stored = loadJSON<Partial<Settings>>(LS.settings, {});
  return {
    ...DEFAULTS,
    ...stored,
    chat: { ...DEFAULTS.chat, ...(stored.chat ?? {}) },
    panels: {
      chat: { ...DEFAULTS.panels.chat, ...(stored.panels?.chat ?? {}) },
      toc: { ...DEFAULTS.panels.toc, ...(stored.panels?.toc ?? {}) },
    },
  };
}

export function saveSettings(s: Settings) {
  saveJSON(LS.settings, s);
}

export function loadDocs(): Record<string, DocMeta> {
  return loadJSON<Record<string, DocMeta>>(LS.docs, {});
}

export function saveDocs(docs: Record<string, DocMeta>) {
  saveJSON(LS.docs, docs);
}

export function themeBg(theme: Theme): string {
  return theme === "dark" ? "#0d0f14" : "#e9edf4";
}

export function applyTheme(theme: Theme) {
  const body = document.body;
  body.classList.toggle("theme-dark", theme === "dark");
  body.classList.toggle("theme-light", theme === "light");
  body.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function applyWarm(warm: boolean, intensity: number) {
  const v = warm ? Math.max(0, Math.min(100, intensity)) / 100 : 0;
  document.documentElement.style.setProperty("--warm", String(v));
  document.body.classList.toggle("warm-on", warm);
}

export function applyBackground(s: Settings, imageData: string | null) {
  const root = document.documentElement;
  root.style.setProperty("--bg-color", s.bgColor || themeBg(s.theme));
  root.style.setProperty(
    "--bg-image-opacity",
    String(Math.max(0, Math.min(100, s.bgImageOpacity)) / 100)
  );
  root.style.setProperty(
    "--surface-opacity",
    String(Math.max(0, Math.min(100, s.surfaceOpacity)) / 100)
  );
  const layer = document.getElementById("bg-image");
  if (layer) {
    layer.style.backgroundImage = imageData ? `url("${imageData}")` : "none";
  }
  document.body.classList.toggle("no-blur", !s.blur);
}
