import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isAuthorizedCron: vi.fn(),
  getDb: vi.fn(),
  getOrganizationBySlug: vi.fn(),
  checkBudget: vi.fn(),
  generateWeeklyReport: vi.fn(),
}));

vi.mock('@/core/cron-auth', () => ({ isAuthorizedCron: mocks.isAuthorizedCron }));
vi.mock('@/db/client', () => ({ getDb: mocks.getDb }));
vi.mock('@/db/repo/organizations', () => ({
  DEMO_ORGANIZATION_SLUG: 'igreja-da-colina',
  getOrganizationBySlug: mocks.getOrganizationBySlug,
}));
vi.mock('@/ai/usage', () => ({ checkBudget: mocks.checkBudget }));
vi.mock('@/core/weekly-report', () => ({
  generateWeeklyReport: mocks.generateWeeklyReport,
  weekStart: vi.fn(() => new Date('2026-08-10T00:00:00Z')),
}));

import { GET } from '@/app/api/cron/weekly-report/route';

describe('GET /api/cron/weekly-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthorizedCron.mockReturnValue(true);
    mocks.getDb.mockReturnValue({});
    mocks.getOrganizationBySlug.mockResolvedValue({ id: 'church-1', name: 'Igreja da Colina' });
  });

  it('rejects an unauthorized request before opening the database', async () => {
    mocks.isAuthorizedCron.mockReturnValue(false);

    const response = await GET(new Request('http://test/api/cron/weekly-report'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ code: 'unauthorized' });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('returns a successful skip before report generation when the monthly budget is exhausted', async () => {
    mocks.checkBudget.mockResolvedValue({ allowed: false, reason: 'tenant' });
    mocks.generateWeeklyReport.mockRejectedValue(new Error('must not generate after a budget denial'));

    const response = await GET(new Request('http://test/api/cron/weekly-report'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ code: 'budget_exceeded', reason: 'tenant' });
  });

  it('preserves the successful skipped-no-activity outcome from generation', async () => {
    mocks.checkBudget.mockResolvedValue({ allowed: true });
    mocks.generateWeeklyReport.mockResolvedValue({ status: 'skipped-no-activity' });

    const response = await GET(new Request('http://test/api/cron/weekly-report'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'skipped-no-activity' });
  });

  it('returns 500 when report generation fails', async () => {
    mocks.checkBudget.mockResolvedValue({ allowed: true });
    mocks.generateWeeklyReport.mockResolvedValue({ status: 'failed', reason: 'writer-failed' });

    const response = await GET(new Request('http://test/api/cron/weekly-report'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ status: 'failed', reason: 'writer-failed' });
  });
});
