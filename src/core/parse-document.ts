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
    const pdf = await getDocumentProxy(bytes);
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
