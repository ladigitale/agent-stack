import type { InputContent } from "./ag-ui";

/**
 * Pièces jointes d'un message : images (réduites dans le navigateur), PDF, documents texte et
 * longs textes collés (repliés en pièce jointe au lieu d'inonder la saisie). Envoyées au backend en
 * `InputContent` AG-UI (`image` / `document`, source `data` en base64).
 */
export type ChatAttachment = {
  id: string;
  kind: "image" | "document" | "text";
  name: string;
  mimeType: string;
  /** Taille envoyée (octets). */
  size: number;
  /** Base64 (images, PDF). */
  data?: string;
  /** Texte (documents texte, texte collé). */
  text?: string;
  /** Aperçu affichable (`data:` d'une image). */
  previewUrl?: string;
};

/** Ce qui reste d'une pièce jointe dans le fil (sans son contenu). */
export type AttachmentMeta = Pick<ChatAttachment, "kind" | "name" | "mimeType" | "size"> & { previewUrl?: string; lines?: number };

export const DEFAULT_ACCEPT = "image/*,application/pdf,text/*,.md,.csv,.json,.xml,.html,.txt,.yaml,.yml";
/** Côté le plus long d'une image envoyée (px). */
export const IMAGE_MAX_SIDE = 1600;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 400_000;
/** Un collage au-delà devient une pièce jointe « Texte collé ». */
export const LONG_PASTE_CHARS = 2000;
export const LONG_PASTE_LINES = 40;

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|ya?ml|log|ini|toml|js|ts|css|php|py|sql)$/i;

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class AttachmentError extends Error {}

export function isLongPaste(text: string): boolean {
  return text.length > LONG_PASTE_CHARS || text.split("\n").length > LONG_PASTE_LINES;
}

/** Texte collé (long) → pièce jointe. */
export function textAttachment(text: string, index = 1): ChatAttachment {
  const clean = text.slice(0, MAX_TEXT_CHARS);
  return {
    id: uid(),
    kind: "text",
    name: index > 1 ? `Texte collé ${index}` : "Texte collé",
    mimeType: "text/plain",
    size: new TextEncoder().encode(clean).length,
    text: clean,
  };
}

/** Fichier choisi, collé ou déposé → pièce jointe (image réduite, PDF, texte). */
export async function fileAttachment(file: File): Promise<ChatAttachment> {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) {
    const { data, mimeType, size, previewUrl } = await shrinkImage(file);
    if (size > MAX_IMAGE_BYTES) throw new AttachmentError(`Image trop lourde (${formatSize(size)}, 5 Mo max).`);
    return { id: uid(), kind: "image", name: file.name || "image", mimeType, size, data, previewUrl };
  }
  if (type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF_BYTES) throw new AttachmentError(`PDF trop lourd (${formatSize(file.size)}, 10 Mo max).`);
    return { id: uid(), kind: "document", name: file.name, mimeType: "application/pdf", size: file.size, data: await toBase64(file) };
  }
  if (type.startsWith("text/") || type === "application/json" || type === "application/xml" || TEXT_EXT.test(file.name)) {
    const text = (await readText(file)).slice(0, MAX_TEXT_CHARS);
    return { id: uid(), kind: "text", name: file.name, mimeType: type || "text/plain", size: new TextEncoder().encode(text).length, text };
  }
  throw new AttachmentError(`« ${file.name} » : format non pris en charge (images, PDF, fichiers texte).`);
}

/** Fragments AG-UI d'un message : texte puis pièces jointes. */
export function toInputContent(text: string, attachments: ChatAttachment[]): InputContent[] {
  const parts: InputContent[] = [];
  if (text.trim()) parts.push({ type: "text", text });
  for (const a of attachments) {
    const metadata = { filename: a.name, ...(a.kind === "text" ? { pasted: a.name.startsWith("Texte collé") } : {}) };
    if (a.kind === "image" && a.data) {
      parts.push({ type: "image", source: { type: "data", value: a.data, mimeType: a.mimeType }, metadata });
    } else if (a.kind === "document" && a.data) {
      parts.push({ type: "document", source: { type: "data", value: a.data, mimeType: a.mimeType }, metadata });
    } else if (a.kind === "text" && a.text !== undefined) {
      parts.push({ type: "document", source: { type: "data", value: utf8ToBase64(a.text), mimeType: "text/plain" }, metadata });
    }
  }
  return parts;
}

export function attachmentMeta(a: ChatAttachment): AttachmentMeta {
  return {
    kind: a.kind,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    ...(a.previewUrl ? { previewUrl: a.previewUrl } : {}),
    ...(a.text !== undefined ? { lines: a.text.split("\n").length } : {}),
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** `Blob.text()` / `arrayBuffer()`, avec repli sur FileReader (environnements anciens). */
function readText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}

function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await readBytes(blob));
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Réduit une image à {@link IMAGE_MAX_SIDE} px de côté (JPEG 0,85, PNG gardé pour la transparence
 * des petits fichiers). Sans canvas (tests, vieux navigateurs) : le fichier tel quel.
 */
async function shrinkImage(file: File): Promise<{ data: string; mimeType: string; size: number; previewUrl: string }> {
  const type = file.type.toLowerCase();
  const raw = async () => {
    const data = await toBase64(file);
    return { data, mimeType: type, size: file.size, previewUrl: `data:${type};base64,${data}` };
  };
  if (type === "image/gif" || typeof createImageBitmap !== "function" || typeof document === "undefined") return raw();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return raw();
  }
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 1024 * 1024) {
    bitmap.close?.();
    return raw();
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return raw();
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const keepPng = type === "image/png" && file.size <= 2 * 1024 * 1024;
  const mimeType = keepPng ? "image/png" : "image/jpeg";
  const url = canvas.toDataURL(mimeType, 0.85);
  const data = url.slice(url.indexOf(",") + 1);
  return { data, mimeType, size: Math.floor((data.length * 3) / 4), previewUrl: url };
}
