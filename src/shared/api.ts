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

export interface AppApi {
  platform: string;
  scanLibrary(): Promise<PdfEntry[]>;
  openPdfDialog(): Promise<string[]>;
  readPdf(filePath: string): Promise<Uint8Array>;
  pickImage(): Promise<ImagePick | null>;
  readImage(path: string): Promise<string | null>;
  revealInFolder(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}
