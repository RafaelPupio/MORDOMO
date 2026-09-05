export type ParsedDocument = { text: string; pageCount: number | null };

export class UnsupportedMediaTypeError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported media type: ${mimeType}`);
    this.name = 'UnsupportedMediaTypeError';
  }
}

const TEXT_TYPES = new Set(['text/markdown', 'text/plain', 'text/x-markdown']);

export async function parseDocument(bytes: Uint8Array, mimeType: string): Promise<ParsedDocument> {
  const type = mimeType.split(';')[0].trim().toLowerCase();

  let text: string;
  let pageCount: number | null = null;

  if (type === 'application/pdf') {
    // Imported lazily: pdf.js is large, and the text paths must not pay for it.
    const { extractText, getDocumentProxy } = await import('unpdf');
    // pdf.js posts the document to its worker with structuredClone(..., { transfer:
    // [bytes.buffer] }). That has two consequences for whatever ArrayBuffer we hand it: if
    // the buffer is not transferable, the parse fails before it starts — on Vercel's
    // runtime the ArrayBuffer behind File.arrayBuffer() is exactly that, and the first PDF
    // ever uploaded in production (2026-09-05) failed with "Cannot transfer object of
    // unsupported type" — and if it IS transferable, the transfer DETACHES it, leaving the
    // caller's bytes empty for the second parse the upload paths perform. A private copy
    // with its own, freshly allocated ArrayBuffer sidesteps both; the caller's array is
    // never touched. Costs one copy of at most MAX_UPLOAD_BYTES.
    const own = new Uint8Array(bytes);
    const pdf = await getDocumentProxy(own);
    const extracted = await extractText(pdf, { mergePages: true });
    text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text;
    pageCount = extracted.totalPages ?? pdf.numPages ?? null;
  } else if (TEXT_TYPES.has(type)) {
    text = new TextDecoder().decode(bytes);
  } else {
    throw new UnsupportedMediaTypeError(mimeType);
  }

  text = normalize(text);
  if (!text) throw new Error('Parsed document is empty — nothing to ingest');
  return { text, pageCount };
}

function normalize(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}
