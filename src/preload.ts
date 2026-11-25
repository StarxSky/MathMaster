import { contextBridge, ipcRenderer } from "electron";
import type { AppApi, ImagePick, PdfEntry } from "./shared/api";

const api: AppApi = {
  platform: process.platform,
  scanLibrary: () => ipcRenderer.invoke("library:scan") as Promise<PdfEntry[]>,
  openPdfDialog: () =>
    ipcRenderer.invoke("dialog:openPdf") as Promise<string[]>,
  readPdf: (filePath: string) =>
    ipcRenderer.invoke("pdf:read", filePath) as Promise<Uint8Array>,
  pickImage: () =>
    ipcRenderer.invoke("image:pick") as Promise<ImagePick | null>,
  readImage: (filePath: string) =>
    ipcRenderer.invoke("image:read", filePath) as Promise<string | null>,
  revealInFolder: (filePath: string) =>
    ipcRenderer.invoke("shell:reveal", filePath) as Promise<void>,
  openExternal: (url: string) =>
    ipcRenderer.invoke("shell:openExternal", url) as Promise<void>,
};

contextBridge.exposeInMainWorld("api", api);
