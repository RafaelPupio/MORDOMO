import { describe, expect, it } from 'vitest';
import { checkRateLimit } from '@/core/rate-limit';
import { createTestDb } from '../helpers/db';

describe('checkRateLimit', () => {
  it('allows up to the limit within a window, then blocks', async () => {
    const db = await createTestDb();
    const now = new Date('2026-08-19T12:00:00Z');
    const opts = { limit: 3, windowSeconds: 600, now };
    expect((await checkRateLimit(db, 'chat:1.2.3.4', opts)).allowed).toBe(true);
    expect((await checkRateLimit(db, 'chat:1.2.3.4', opts)).allowed).toBe(true);
    const third = await checkRateLimit(db, 'chat:1.2.3.4', opts);
    expect(third).toEqual({ allowed: true, remaining: 0 });
    expect((await checkRateLimit(db, 'chat:1.2.3.4', opts)).allowed).toBe(false);
  });

  it('resets when the window rolls over', async () => {
    const db = await createTestDb();
    const opts = { limit: 1, windowSeconds: 600 };
    await checkRateLimit(db, 'k', { ...opts, now: new Date('2026-08-19T12:00:00Z') });
    const next = await checkRateLimit(db, 'k', { ...opts, now: new Date('2026-08-19T12:10:01Z') });
    expect(next.allowed).toBe(true);
  });

  it('tracks keys independently', async () => {
    const db = await createTestDb();
    const now = new Date('2026-08-19T12:00:00Z');
    await checkRateLimit(db, 'a', { limit: 1, windowSeconds: 600, now });
    expect((await checkRateLimit(db, 'b', { limit: 1, windowSeconds: 600, now })).allowed).toBe(true);
  });
});
