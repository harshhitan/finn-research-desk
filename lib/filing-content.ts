import { extractText, getDocumentProxy } from "unpdf";

export type FilingContent = {
  documentId: string;
  status: "ready" | "unavailable";
  sourceUrl: string;
  pages: { page: number; text: string }[];
  pageCount?: number;
  extractedAt: string;
  contentHash?: string;
  reason?: string;
};

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 40;
const SOURCE_HOSTS = new Set(["www.ril.com", "ril.com", "rilstaticasset.akamaized.net"]);

export function validateFilingUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !SOURCE_HOSTS.has(url.hostname) || url.username || url.password || url.port) {
    throw new Error("Only the original Reliance document host is allowed.");
  }
  return url;
}

export async function downloadFiling(url: string, fetcher: typeof fetch = fetch) {
  let current = validateFilingUrl(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetcher(current.href, { redirect: "manual", signal: AbortSignal.timeout(12000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === 3) throw new Error("The original document redirect could not be followed.");
      current = validateFilingUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error("The issuer could not provide the original PDF. Please try again."); }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body?.cancel(); throw new Error("This PDF is too large for the in-app reader. Please open the original."); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The issuer returned an empty document.");
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) throw new Error("This PDF is too large for the in-app reader. Please open the original.");
        chunks.push(value);
      }
    } catch (error) { await reader.cancel(); throw error; } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-")) throw new Error("The issuer did not return a readable PDF. Please open the original.");
    return bytes;
  }
  throw new Error("The original PDF could not be reached.");
}

export async function extractFiling(documentId: string, sourceUrl: string, bytes: Uint8Array): Promise<FilingContent> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  const options = { isEvalSupported: false, useWasm: false, maxImageSize: 1_000_000 };
  const pdf = await getDocumentProxy(bytes, options);
  try {
    if (pdf.numPages > MAX_PAGES) throw new Error("This document exceeds the in-app reader's 40-page limit. Please open the original.");
    const result = await extractText(pdf, { mergePages: false });
    const pages = (result.text as string[]).map((text, i) => ({ page: i + 1, text: text.replace(/\u0000/g, "").trim() }));
    if (pages.reduce((total, p) => total + p.text.length, 0) < 40) throw new Error("This PDF has no usable text layer. It may be scanned; please open the original to read it.");
    if (pages.reduce((total, p) => total + p.text.length, 0) > 100_000) throw new Error("This document contains too much text for the in-app reader. Please open the original.");
    return { documentId, sourceUrl, status: "ready", pages, pageCount: pdf.numPages, extractedAt: new Date().toISOString(), contentHash: Array.from(new Uint8Array(hash)).map(x => x.toString(16).padStart(2, "0")).join("") };
  } finally { await pdf.loadingTask.destroy(); }
}

export async function readFiling(documentId: string, sourceUrl: string): Promise<FilingContent> {
  try { return await extractFiling(documentId, sourceUrl, await downloadFiling(sourceUrl)); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    const safeReason = /original|issuer|too large|scanned|text layer|too much text|40-page/.test(message) ? message : "The PDF text could not be extracted. Please retry or open the original document.";
    return { documentId, sourceUrl, status: "unavailable", pages: [], extractedAt: new Date().toISOString(), reason: safeReason };
  }
}
