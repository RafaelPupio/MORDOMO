import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, INGEST_STATUSES } from '@/core/ingest-status';

describe('ingest status machine', () => {
  it('lists every status', () => {
    expect(INGEST_STATUSES).toEqual([
      'uploaded', 'parsing', 'extracting', 'verifying', 'published', 'failed',
    ]);
  });

  it('allows the happy path in order', () => {
    expect(canTransition('uploaded', 'parsing')).toBe(true);
    expect(canTransition('parsing', 'extracting')).toBe(true);
    expect(canTransition('extracting', 'verifying')).toBe(true);
    expect(canTransition('verifying', 'published')).toBe(true);
  });

  it('allows failing from any working state', () => {
    for (const s of ['uploaded', 'parsing', 'extracting', 'verifying'] as const) {
      expect(canTransition(s, 'failed')).toBe(true);
    }
  });

  it('allows retrying a failed document from the start', () => {
    expect(canTransition('failed', 'parsing')).toBe(true);
  });

  it('rejects skipping stages and rejects leaving a terminal success', () => {
    expect(canTransition('uploaded', 'published')).toBe(false);
    expect(canTransition('parsing', 'verifying')).toBe(false);
    expect(canTransition('published', 'parsing')).toBe(false);
    expect(canTransition('published', 'failed')).toBe(false);
  });

  it('assertTransition throws with both states named', () => {
    expect(() => assertTransition('uploaded', 'published')).toThrow(/uploaded.*published/);
    expect(() => assertTransition('uploaded', 'parsing')).not.toThrow();
  });
});
