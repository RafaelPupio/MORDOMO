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
