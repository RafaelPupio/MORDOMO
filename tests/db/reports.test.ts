import { describe, expect, it } from 'vitest';
import { getReport, getReportForPeriod, listReports, upsertReport } from '@/db/repo/reports';
import { createTestDb, seedChurch } from '../helpers/db';

const start = new Date('2026-08-10T00:00:00Z');
const end = new Date('2026-08-17T00:00:00Z');

describe('reports repo', () => {
  it('creates a report and reads it back', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const row = await upsertReport(db, {
      churchId: church.id, periodStart: start, periodEnd: end,
      findings: { topQuestions: ['horário do culto'] }, body: 'Resumo da semana.',
    });
    expect((await getReport(db, church.id, row.id))?.body).toBe('Resumo da semana.');
    expect(await listReports(db, church.id)).toHaveLength(1);
  });

  it('re-running the same week replaces rather than duplicates', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    await upsertReport(db, { churchId: church.id, periodStart: start, periodEnd: end, findings: {}, body: 'Primeira versão.' });
    await upsertReport(db, { churchId: church.id, periodStart: start, periodEnd: end, findings: {}, body: 'Segunda versão.' });
    const all = await listReports(db, church.id);
    expect(all).toHaveLength(1);
    expect(all[0].body).toBe('Segunda versão.');
  });

  it('never returns another church’s report', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const row = await upsertReport(db, { churchId: b.id, periodStart: start, periodEnd: end, findings: {}, body: 'De B.' });
    expect(await getReport(db, a.id, row.id)).toBeUndefined();
    expect(await listReports(db, a.id)).toHaveLength(0);
    expect(await getReportForPeriod(db, a.id, start)).toBeUndefined();
  });

  it('finds an existing report for a period', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    expect(await getReportForPeriod(db, church.id, start)).toBeUndefined();
    await upsertReport(db, { churchId: church.id, periodStart: start, periodEnd: end, findings: {}, body: 'x' });
    expect(await getReportForPeriod(db, church.id, start)).toBeDefined();
  });
});
