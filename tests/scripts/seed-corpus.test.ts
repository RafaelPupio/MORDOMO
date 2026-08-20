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

  it('events.json parses with valid dates', () => {
    const eventsRaw = JSON.parse(readFileSync(path.join(SEED_DIR, 'events.json'), 'utf8')) as { startsAt: string; title: string }[];
    expect(eventsRaw.length).toBeGreaterThanOrEqual(5);
    for (const e of eventsRaw) expect(Number.isNaN(new Date(e.startsAt).getTime())).toBe(false);
  });
});
