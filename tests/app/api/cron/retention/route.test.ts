import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isAuthorizedCron: vi.fn(),
  getDb: vi.fn(),
  runRetention: vi.fn(),
  parseRetentionDays: vi.fn(),
}));

vi.mock('@/core/cron-auth', () => ({ isAuthorizedCron: mocks.isAuthorizedCron }));
vi.mock('@/db/client', () => ({ getDb: mocks.getDb }));
vi.mock('@/core/retention', () => ({
  runRetention: mocks.runRetention,
  parseRetentionDays: mocks.parseRetentionDays,
}));

import { GET } from '@/app/api/cron/retention/route';

const counts = { tickets: 0, prayerRequests: 0, conversations: 0, messages: 0, rateLimitWindows: 0 };

describe('GET /api/cron/retention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthorizedCron.mockReturnValue(true);
    // The route only does `db.select({...}).from(organizations)`; two organizations is enough.
    mocks.getDb.mockReturnValue({ select: () => ({ from: async () => [{ id: 'c1', slug: 'one' }, { id: 'c2', slug: 'two' }] }) });
    mocks.parseRetentionDays.mockReturnValue(null);
    mocks.runRetention.mockResolvedValue({ dryRun: true, retentionDays: null, cutoff: null, counts });
  });

  it('rejects an unauthorized request before opening the database', async () => {
    mocks.isAuthorizedCron.mockReturnValue(false);
    const res = await GET(new Request('http://test/api/cron/retention'));
    expect(res.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.runRetention).not.toHaveBeenCalled();
  });

  it('reads the secret and the period from the environment, not from constants', async () => {
    process.env.CRON_SECRET = 'cron-secret-under-test';
    process.env.RETENTION_DAYS = '120';
    try {
      await GET(new Request('http://test/api/cron/retention'));
      expect(mocks.isAuthorizedCron).toHaveBeenCalledWith(expect.any(Request), 'cron-secret-under-test');
      expect(mocks.parseRetentionDays).toHaveBeenCalledWith('120');
    } finally {
      delete process.env.CRON_SECRET;
      delete process.env.RETENTION_DAYS;
    }
  });

  it('runs a dry run for every church when no period is configured', async () => {
    const res = await GET(new Request('http://test/api/cron/retention'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.organizations.map((c: { church: string }) => c.church)).toEqual(['one', 'two']);
    expect(mocks.runRetention).toHaveBeenCalledTimes(2);
    expect(mocks.runRetention.mock.calls[0][1]).toMatchObject({ organizationId: 'c1', retentionDays: null, previewDays: 90 });
  });

  it('passes the configured period through, unchanged, to every church', async () => {
    mocks.parseRetentionDays.mockReturnValue(120);
    mocks.runRetention.mockResolvedValue({ dryRun: false, retentionDays: 120, cutoff: new Date(), counts });
    const res = await GET(new Request('http://test/api/cron/retention'));
    const body = await res.json();
    expect(body.dryRun).toBe(false);
    expect(body.retentionDays).toBe(120);
    expect(mocks.runRetention.mock.calls.map((c) => c[1].retentionDays)).toEqual([120, 120]);
  });

  it('reports each church with its counts, cutoff and dryRun', async () => {
    mocks.parseRetentionDays.mockReturnValue(120);
    const cutoff = new Date('2026-05-11T12:00:00Z');
    mocks.runRetention.mockResolvedValue({ dryRun: false, retentionDays: 120, cutoff, counts: { ...counts, conversations: 3 } });
    const res = await GET(new Request('http://test/api/cron/retention'));
    const body = await res.json();
    expect(body.organizations[0]).toEqual({ church: 'one', dryRun: false, retentionDays: 120, cutoff: cutoff.toISOString(), counts: { ...counts, conversations: 3 } });
  });

  it('answers 500 internal_error when a purge itself fails mid-loop', async () => {
    mocks.runRetention.mockRejectedValueOnce(new Error('update or delete violates foreign key'));
    const res = await GET(new Request('http://test/api/cron/retention'));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ code: 'internal_error' });
    expect(mocks.runRetention).toHaveBeenCalledTimes(1); // stops; does not skip to the next church
  });

  it('answers 500 internal_error, never a stack, when the database fails', async () => {
    mocks.getDb.mockReturnValue({ select: () => ({ from: async () => { throw new Error('connection terminated unexpectedly'); } }) });
    const res = await GET(new Request('http://test/api/cron/retention'));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ code: 'internal_error' });
  });
});
