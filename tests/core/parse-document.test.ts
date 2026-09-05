import { describe, expect, it } from 'vitest';
import { parseDocument, UnsupportedMediaTypeError } from '@/core/parse-document';

const enc = (s: string) => new TextEncoder().encode(s);

describe('parseDocument', () => {
  it('passes markdown through unchanged and reports no page count', async () => {
    const md = '# Boletim\n\n## Culto\n\nDomingo às 10h.';
    const out = await parseDocument(enc(md), 'text/markdown');
    expect(out.text).toBe(md);
    expect(out.pageCount).toBeNull();
  });

  it('passes plain text through', async () => {
    const out = await parseDocument(enc('Culto de domingo às 10h.'), 'text/plain');
    expect(out.text).toContain('10h');
  });

  it('normalizes CRLF and trims trailing whitespace', async () => {
    const out = await parseDocument(enc('linha um\r\nlinha dois   \r\n'), 'text/plain');
    expect(out.text).toBe('linha um\nlinha dois');
  });

  it('rejects an unsupported media type by name', async () => {
    await expect(parseDocument(enc('x'), 'image/png')).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
    await expect(parseDocument(enc('x'), 'image/png')).rejects.toThrow(/image\/png/);
  });

  it('rejects empty input rather than producing an empty document', async () => {
    await expect(parseDocument(enc('   \n  '), 'text/plain')).rejects.toThrow(/empty/i);
  });

  it('extracts text and a page count from a real PDF', async () => {
    const pdf = await makeOnePagePdf('Culto de domingo as 10h');
    const out = await parseDocument(pdf, 'application/pdf');
    expect(out.text).toContain('Culto de domingo');
    expect(out.pageCount).toBe(1);
  });
});

// A minimal, valid single-page PDF written by hand — avoids committing a binary fixture
// and keeps the test honest (it exercises the real PDF code path, not a stub).
async function makeOnePagePdf(text: string): Promise<Uint8Array> {
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

// pdf.js hands the document to its (fake) worker with structuredClone(..., { transfer:
// [bytes.buffer] }). Two consequences the first production PDF upload found (2026-09-05):
// a Uint8Array that is a VIEW over Node's Buffer pool cannot be transferred — Node throws
// "Cannot transfer object of unsupported type", which is exactly what Vercel's runtime hands
// the ingest for a 638-byte one-page PDF — and a successful transfer DETACHES the caller's
// buffer, so the second parse the staff upload path performs on the same bytes sees nothing.
// parseDocument must therefore give pdf.js a private copy with its own ArrayBuffer.
function minimalPdf(): Uint8Array {
  const enc = new TextEncoder();
  const content = 'BT /F1 14 Tf 72 720 Td (Culto de gratidao 12/12/2026 sabado as 19h30) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(enc.encode(out).length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = enc.encode(out).length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc.encode(out);
}

describe('parseDocument (PDF) and the bytes it is handed', () => {
  it('parses a Uint8Array whose ArrayBuffer cannot be transferred', async () => {
    // pdf.js transfers the buffer when the view covers all of it. Some buffers cannot be
    // transferred — Node's own Buffer pool, WebAssembly memory, and whatever backs
    // File.arrayBuffer() on Vercel's runtime — and structuredClone answers "Cannot transfer
    // object of unsupported type", the exact message the first production PDF upload got.
    // WebAssembly memory is the construction that exists on every Node version; the PDF
    // sits at the start and the rest is whitespace, which a PDF reader ignores.
    const memory = new WebAssembly.Memory({ initial: 1 }); // 64 KiB, untransferable
    const view = new Uint8Array(memory.buffer);
    view.fill(0x20);
    view.set(minimalPdf());
    expect(() => structuredClone(view, { transfer: [view.buffer] })).toThrow(/Cannot transfer/);

    const parsed = await parseDocument(view, 'application/pdf');
    expect(parsed.text).toContain('Culto de gratidao 12/12/2026');
  });

  it('parses a Uint8Array that is a view over Node\'s Buffer pool', async () => {
    // Buffer.from copies small payloads into the shared pool; a plain Uint8Array view over
    // that pool passes pdf.js's "is it a Uint8Array" check and then fails its transfer.
    const pooled = Buffer.from(minimalPdf());
    const view = new Uint8Array(pooled.buffer, pooled.byteOffset, pooled.byteLength);
    expect(view.buffer.byteLength).toBeGreaterThan(view.byteLength); // genuinely pooled

    const parsed = await parseDocument(view, 'application/pdf');
    expect(parsed.text).toContain('Culto de gratidao 12/12/2026');
    expect(parsed.pageCount).toBe(1);
  });

  it('leaves the caller\'s bytes intact so the same array can be parsed again', async () => {
    const bytes = minimalPdf();
    const first = await parseDocument(bytes, 'application/pdf');
    expect(bytes.byteLength).toBeGreaterThan(0); // not detached by the transfer
    const second = await parseDocument(bytes, 'application/pdf');
    expect(second.text).toBe(first.text);
  });
});
