import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '@/core/chunking';

const SEED_DIR = path.join(process.cwd(), 'content', 'seed');

describe('seed corpus', () => {
  it('has the three markdown documents and events.json', () => {
    const files = readdirSync(SEED_DIR).sort();
    expect(files).toEqual(['boletim-outubro-2026.md', 'events.json', 'horarios-e-contato.md', 'ministerios.md']);
  });

  it('every markdown doc chunks into non-empty pieces and carries the fictional disclaimer', () => {
    for (const file of readdirSync(SEED_DIR).filter((f) => f.endsWith('.md'))) {
      const text = readFileSync(path.join(SEED_DIR, file), 'utf8');
      expect(text).toMatch(/fictíci/i);
      const pieces = chunkMarkdown(text);
      expect(pieces.length).toBeGreaterThan(0);
    }
  });

  it('every seed file in the corpus carries the fictional disclaimer, markdown or not', () => {
    // The three .md files carry the disclaimer inline as prose (checked above); events.json
    // is structured data with no prose to carry it in, so it carries the same guarantee as
    // an explicit `disclaimer` field instead. This test covers the whole seed directory, not
    // just files that happen to end in .md, so a future non-markdown seed file can't ship
    // without the same guarantee by construction.
    for (const file of readdirSync(SEED_DIR)) {
      if (file.endsWith('.md')) continue;
      const text = readFileSync(path.join(SEED_DIR, file), 'utf8');
      expect(text).toMatch(/fictíci/i);
    }
  });

  it('events.json parses with valid dates and a disclaimer', () => {
    const eventsFile = JSON.parse(readFileSync(path.join(SEED_DIR, 'events.json'), 'utf8')) as {
      disclaimer: string;
      events: { startsAt: string; title: string }[];
    };
    expect(eventsFile.disclaimer).toMatch(/fictíci/i);
    expect(eventsFile.events.length).toBeGreaterThanOrEqual(5);
    for (const e of eventsFile.events) expect(Number.isNaN(new Date(e.startsAt).getTime())).toBe(false);
  });
});
