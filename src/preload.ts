import { contextBridge, ipcRenderer } from "electron";
import type {
  AiRequest,
  AiResult,
  Annotation,
  AnnotationFile,
  AppApi,
  ImagePick,
  PdfEntry,
  SummaryPayload,
} from "./shared/api";

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
  getDefaultDataDir: () =>
    ipcRenderer.invoke("data:defaultDir") as Promise<string>,
  pickDirectory: (defaultPath?: string) =>
    ipcRenderer.invoke("dialog:pickDirectory", defaultPath) as Promise<
      string | null
    >,
  ensureDataDir: (root?: string) =>
    ipcRenderer.invoke("data:ensure", root) as Promise<string>,
  loadAnnotations: (root: string | undefined, documentPath: string) =>
    ipcRenderer.invoke(
      "annotations:load",
      root,
      documentPath
    ) as Promise<AnnotationFile | null>,
  saveAnnotations: (
    root: string | undefined,
    documentPath: string,
    documentName: string,
    annotations: Annotation[]
  ) =>
    ipcRenderer.invoke(
      "annotations:save",
      root,
      documentPath,
      documentName,
      annotations
    ) as Promise<string>,
  aiSummarize: (request: AiRequest) =>
    ipcRenderer.invoke("ai:summarize", request) as Promise<AiResult>,
  exportSummaryPdf: (root: string | undefined, payload: SummaryPayload) =>
    ipcRenderer.invoke(
      "summary:exportPdf",
      root,
      payload
    ) as Promise<string>,
};

contextBridge.exposeInMainWorld("api", api);
