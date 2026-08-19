import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '@/core/chunking';

describe('chunkMarkdown', () => {
  it('keeps a short document as a single chunk', () => {
    const out = chunkMarkdown('# Title\n\nShort body.');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ seq: 0, content: '# Title\n\nShort body.' });
  });

  it('splits on h2 sections', () => {
    const doc = '# Doc\n\nIntro.\n\n## Horários\n\nDomingo 10h.\n\n## Endereço\n\nRua X, 123.';
    const out = chunkMarkdown(doc);
    expect(out.length).toBe(3);
    expect(out[1].content).toContain('Horários');
    expect(out[2].content).toContain('Endereço');
  });

  it('splits an oversized section by paragraphs under the max size', () => {
    const para = 'palavra '.repeat(100).trim(); // ~800 chars
    const doc = `## Grande\n\n${para}\n\n${para}\n\n${para}`;
    const out = chunkMarkdown(doc);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.content.length).toBeLessThanOrEqual(1500);
  });

  it('assigns sequential seq starting at 0', () => {
    const doc = '## A\n\nx.\n\n## B\n\ny.';
    expect(chunkMarkdown(doc).map((c) => c.seq)).toEqual([0, 1]);
  });
});
