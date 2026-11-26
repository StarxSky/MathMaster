export interface PdfEntry {
  name: string;
  path: string;
  folder: string;
  size: number;
}

export interface ImagePick {
  path: string;
  dataUrl: string;
}

export interface Annotation {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  note: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface AnnotationFile {
  version: 1;
  document: {
    path: string;
    name: string;
  };
  annotations: Annotation[];
  updatedAt: number;
}

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiRequest {
  apiKey: string;
  model?: string;
  messages: AiMessage[];
}

export interface AiResult {
  ok: boolean;
  content?: string;
  error?: string;
}

export interface SummaryPayload {
  title: string;
  documentPath: string;
  annotations: Annotation[];
  summary: string;
}

export interface AppApi {
  platform: string;
  scanLibrary(): Promise<PdfEntry[]>;
  openPdfDialog(): Promise<string[]>;
  readPdf(filePath: string): Promise<Uint8Array>;
  pickImage(): Promise<ImagePick | null>;
  readImage(path: string): Promise<string | null>;
  revealInFolder(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  getDefaultDataDir(): Promise<string>;
  pickDirectory(defaultPath?: string): Promise<string | null>;
  ensureDataDir(root?: string): Promise<string>;
  loadAnnotations(
    root: string | undefined,
    documentPath: string
  ): Promise<AnnotationFile | null>;
  saveAnnotations(
    root: string | undefined,
    documentPath: string,
    documentName: string,
    annotations: Annotation[]
  ): Promise<string>;
  aiSummarize(request: AiRequest): Promise<AiResult>;
  exportSummaryPdf(
    root: string | undefined,
    payload: SummaryPayload
  ): Promise<string>;
}
