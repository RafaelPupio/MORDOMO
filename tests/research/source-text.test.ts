import { describe, expect, it } from 'vitest';
import { normalizeSourceExcerpt, quoteAppearsInSource } from '@/research/source-text';

describe('public source normalization', () => {
  it('removes control characters, normalizes Unicode, and collapses horizontal whitespace', () => {
    const decomposed = 'Cafe\u0301';
    expect(normalizeSourceExcerpt(`\u0000${decomposed}\t  opens\r\nMonday\u0085`)).toBe('Café opens\nMonday');
  });

  it('caps the persisted and model-input excerpt at 40,000 characters', () => {
    const normalized = normalizeSourceExcerpt('a'.repeat(40_001));
    expect(normalized).toHaveLength(40_000);
    expect(normalized).toBe('a'.repeat(40_000));
  });
});

describe('public source quote grounding', () => {
  it('accepts grounded quotes across benign typography drift', () => {
    const source = normalizeSourceExcerpt('Fictional Clinic — “São José” opens Monday.');
    expect(quoteAppearsInSource(source, 'clinic - "Sao Jose" opens Monday')).toBe(true);
  });

  it('rejects empty and invented quotes', () => {
    const source = normalizeSourceExcerpt('Fictional Clinic opens Monday.');
    expect(quoteAppearsInSource(source, '')).toBe(false);
    expect(quoteAppearsInSource(source, 'opens Sunday')).toBe(false);
  });
});
