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

  it('hard-splits a single paragraph longer than the max under a heading', () => {
    const doc = '## Seção\n\n' + 'x'.repeat(2000);
    const out = chunkMarkdown(doc);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(c.content.length).toBeLessThanOrEqual(1500);
      expect(c.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps the section heading on every chunk of an oversized section', () => {
    const para = 'palavra '.repeat(100).trim(); // ~800 chars
    const doc = `## Grande\n\n${para}\n\n${para}\n\n${para}`;
    const out = chunkMarkdown(doc);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.content).toContain('Grande');
  });

  it('chunks a very long unbroken run of text with no blank lines, losing nothing', () => {
    const words = Array.from({ length: 400 }, (_, i) => `palavra${i}`);
    const doc = words.join(' '); // no h2, no blank lines, ~4700 chars
    const out = chunkMarkdown(doc);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(c.content.length).toBeLessThanOrEqual(1500);
      expect(c.content.trim().length).toBeGreaterThan(0);
    }
    // Every word from the source survives, in order, across the chunks.
    const rebuiltWords = out.flatMap((c) => c.content.split(/\s+/));
    expect(rebuiltWords).toEqual(words);
  });

  it('never emits an empty or whitespace-only chunk for oversized inputs', () => {
    const para = 'x'.repeat(3000);
    const doc = `## Título\n\n${para}`;
    const out = chunkMarkdown(doc);
    for (const c of out) expect(c.content.trim()).not.toBe('');
  });

  it('never exceeds the cap when a heading is long enough to squeeze the budget', () => {
    const doc = '## ' + 'H'.repeat(1495) + '\n\nword';
    const out = chunkMarkdown(doc);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(c.content.length).toBeLessThanOrEqual(1500);
  });

  it('never exceeds the cap for an extremely long heading', () => {
    const doc = '## ' + 'H'.repeat(2997) + '\n\nword';
    const out = chunkMarkdown(doc);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(c.content.length).toBeLessThanOrEqual(1500);
  });

  it('emits a heading-only oversized section instead of dropping it', () => {
    const doc = '## ' + 'H'.repeat(1498);
    const out = chunkMarkdown(doc);
    expect(out.length).toBeGreaterThan(0);
    const rebuilt = out.map((c) => c.content).join('');
    expect(rebuilt).toContain('H'.repeat(100));
  });

  it('never silently drops a malformed oversized section among normal ones', () => {
    // Joined with '' (not a separator) so a contiguous run that got hard-split
    // across a chunk boundary can still be found as one contiguous substring --
    // this is checking content survival, not chunk-by-chunk shape.
    const avisoBody = 'AVISO' + 'z'.repeat(2000);
    const doc = [
      '# Igreja',
      '## Horários',
      'Domingo 10h.',
      `## ${avisoBody}`,
      '## Endereço',
      'Rua X, 123.',
    ].join('\n\n');
    const out = chunkMarkdown(doc);
    const rebuilt = out.map((c) => c.content).join('');
    expect(rebuilt).toContain('Horários');
    expect(rebuilt).toContain('Domingo 10h.');
    expect(rebuilt).toContain(avisoBody);
    expect(rebuilt).toContain('Endereço');
    expect(rebuilt).toContain('Rua X, 123.');
  });

  it('property check: every chunk of a mixed multi-section document is within cap and non-empty', () => {
    const longSection = '## Longa\n\n' + Array.from({ length: 300 }, (_, i) => `palavra${i}`).join(' ');
    const doc = [
      '# Doc',
      '## Curta',
      'Texto curto.',
      longSection,
      '## Outra',
      'Mais um texto curto.',
    ].join('\n\n');
    const out = chunkMarkdown(doc);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      expect(c.content.length).toBeLessThanOrEqual(1500);
      expect(c.content.trim().length).toBeGreaterThan(0);
    }
  });
});
