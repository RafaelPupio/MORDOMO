import { describe, expect, it, vi } from 'vitest';
import { generateWeeklyReport, weekStart } from '@/core/weekly-report';
import { getReport, getReportForPeriod, listReports } from '@/db/repo/reports';
import { prayerRequests, tickets, usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

const PERIOD_START = new Date('2026-08-10T00:00:00Z');
const PERIOD_END = new Date('2026-08-17T00:00:00Z');
const IN_WINDOW = new Date('2026-08-12T12:00:00Z');

const FINDINGS_PAYLOAD = {
  topQuestions: [{ question: 'Qual o horário do culto de domingo?', count: 5 }],
  unansweredQuestions: ['Vocês têm estacionamento?'],
  prayerThemes: [{ theme: 'saúde', count: 3 }],
  notableTickets: ['Pedido de visita pastoral'],
  summaryStat: '1 conversa e 1 pedido de oração nesta semana.',
};

// Mirrors tests/agent/analyst.test.ts's findingsModel: a generateObject-shaped mock that
// hands back a fixed WeekFindings payload as JSON text.
async function findingsModel(payload: unknown = FINDINGS_PAYLOAD) {
  const { MockLanguageModelV3 } = await import('ai/test');
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 300, noCache: 300, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 120, text: 120, reasoning: undefined },
      },
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      warnings: [],
    }),
  });
}

// Mirrors tests/agent/reply-drafter.test.ts's textModel: a generateText-shaped mock that
// hands back a fixed prose string.
async function textModel(text: string) {
  const { MockLanguageModelV3 } = await import('ai/test');
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 400, noCache: 400, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 250, text: 250, reasoning: undefined },
      },
      content: [{ type: 'text', text }],
      warnings: [],
    }),
  });
}

async function throwingModel(message: string) {
  const { MockLanguageModelV3 } = await import('ai/test');
  return new MockLanguageModelV3({ doGenerate: async () => { throw new Error(message); } });
}

describe('generateWeeklyReport', () => {
  it('gathers activity, analyses, writes, and publishes a report for a week with activity', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db, 'Igreja da Colina');
    await db.insert(prayerRequests).values({ churchId: church.id, request: 'peço oração', createdAt: IN_WINDOW });

    const result = await generateWeeklyReport(
      {
        db,
        analystModel: await findingsModel(),
        writerModel: await textModel('## Resumo da Semana\n\nUm pedido de oração.'),
      },
      { churchId: church.id, churchName: church.name, periodStart: PERIOD_START, periodEnd: PERIOD_END },
    );

    expect(result.status).toBe('published');
    expect(result.reportId).toBeDefined();

    const row = await getReport(db, church.id, result.reportId as string);
    expect(row).toBeDefined();
    expect(row?.findings).toEqual(FINDINGS_PAYLOAD);
    expect(row?.body).toContain('Resumo da Semana');
  });

  // Zero model calls is asserted with poison mocks (their own doGenerate spies, not a
  // shared module mock) whose doGenerate rejects if ever invoked — a stronger assertion
  // than merely checking the result, since it proves neither agent was ever reached.
  it('skips with zero model calls, and publishes nothing, when the week has no activity at all', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const { MockLanguageModelV3 } = await import('ai/test');
    const analystDoGenerate = vi.fn().mockRejectedValue(
      new Error('analyst must not be called for a week with no activity'),
    );
    const writerDoGenerate = vi.fn().mockRejectedValue(
      new Error('writer must not be called for a week with no activity'),
    );
    const analystModel = new MockLanguageModelV3({ doGenerate: analystDoGenerate });
    const writerModel = new MockLanguageModelV3({ doGenerate: writerDoGenerate });

    const result = await generateWeeklyReport(
      { db, analystModel, writerModel },
      { churchId: church.id, churchName: church.name, periodStart: PERIOD_START, periodEnd: PERIOD_END },
    );

    expect(result).toEqual({ status: 'skipped-no-activity' });
    expect(analystDoGenerate).not.toHaveBeenCalled();
    expect(writerDoGenerate).not.toHaveBeenCalled();
    expect(await getReportForPeriod(db, church.id, PERIOD_START)).toBeUndefined();
  });

  it('publishes a cost-only week so the digest accounts for what the church spent', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    await db.insert(usageLedger).values({
      churchId: church.id,
      feature: 'chat.reply',
      model: 'test/model',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 1.75,
      createdAt: IN_WINDOW,
    });

    const result = await generateWeeklyReport(
      {
        db,
        analystModel: await findingsModel(),
        writerModel: await textModel('## Resumo\n\nCusto semanal registrado.'),
      },
      { churchId: church.id, churchName: church.name, periodStart: PERIOD_START, periodEnd: PERIOD_END },
    );

    expect(result.status).toBe('published');
    expect(await getReportForPeriod(db, church.id, PERIOD_START)).toBeDefined();
  });

  it('fails and publishes nothing when the analyst fails', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    await db.insert(prayerRequests).values({ churchId: church.id, request: 'peço oração', createdAt: IN_WINDOW });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { MockLanguageModelV3 } = await import('ai/test');
    const writerDoGenerate = vi.fn().mockRejectedValue(
      new Error('writer must not be called after the analyst fails'),
    );

    const result = await generateWeeklyReport(
      {
        db,
        analystModel: await throwingModel('analyst outage'),
        writerModel: new MockLanguageModelV3({ doGenerate: writerDoGenerate }),
      },
      { churchId: church.id, churchName: church.name, periodStart: PERIOD_START, periodEnd: PERIOD_END },
    );

    expect(result.status).toBe('failed');
    expect(result.reportId).toBeUndefined();
    expect(writerDoGenerate).not.toHaveBeenCalled();
    expect(await getReportForPeriod(db, church.id, PERIOD_START)).toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('fails and publishes nothing (no report row with an empty body) when the writer fails after a successful analysis', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    await db.insert(prayerRequests).values({ churchId: church.id, request: 'peço oração', createdAt: IN_WINDOW });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await generateWeeklyReport(
      {
        db,
        analystModel: await findingsModel(),
        writerModel: await throwingModel('writer outage'),
      },
      { churchId: church.id, churchName: church.name, periodStart: PERIOD_START, periodEnd: PERIOD_END },
    );

    expect(result.status).toBe('failed');
    expect(result.reportId).toBeUndefined();
    expect(await getReportForPeriod(db, church.id, PERIOD_START)).toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('replaces rather than duplicates when the same week is generated twice', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    await db.insert(prayerRequests).values({ churchId: church.id, request: 'peço oração', createdAt: IN_WINDOW });

    const first = await generateWeeklyReport(
      { db, analystModel: await findingsModel(), writerModel: await textModel('Primeira versão.') },
      { churchId: church.id, churchName: church.name, periodStart: PERIOD_START, periodEnd: PERIOD_END },
    );
    const second = await generateWeeklyReport(
      { db, analystModel: await findingsModel(), writerModel: await textModel('Segunda versão.') },
      { churchId: church.id, churchName: church.name, periodStart: PERIOD_START, periodEnd: PERIOD_END },
    );

    expect(first.status).toBe('published');
    expect(second.status).toBe('published');
    const all = await listReports(db, church.id);
    expect(all).toHaveLength(1);
    expect(all[0].body).toBe('Segunda versão.');
  });

  it('generating for church A never reads church B’s activity', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    await db.insert(tickets).values({ churchId: a.id, topic: 'TICKET_MARCADOR_A', createdAt: IN_WINDOW });
    await db.insert(tickets).values({ churchId: b.id, topic: 'TICKET_MARCADOR_B', createdAt: IN_WINDOW });

    const { MockLanguageModelV3 } = await import('ai/test');
    const capturingModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 40, text: 40, reasoning: undefined },
        },
        content: [{ type: 'text', text: JSON.stringify(FINDINGS_PAYLOAD) }],
        warnings: [],
      }),
    });

    const result = await generateWeeklyReport(
      { db, analystModel: capturingModel, writerModel: await textModel('resumo') },
      { churchId: a.id, churchName: a.name, periodStart: PERIOD_START, periodEnd: PERIOD_END },
    );

    expect(result.status).toBe('published');
    expect(capturingModel.doGenerateCalls).toHaveLength(1);
    const sentToModel = JSON.stringify(capturingModel.doGenerateCalls[0].prompt);
    expect(sentToModel).toContain('TICKET_MARCADOR_A');
    expect(sentToModel).not.toContain('TICKET_MARCADOR_B');
    expect(await getReportForPeriod(db, b.id, PERIOD_START)).toBeUndefined();
  });
});

describe('weekStart', () => {
  it('resolves to the UTC Monday one week before "now", when "now" is itself a Monday', () => {
    const monday = new Date('2026-08-17T09:00:00Z'); // Monday
    expect(weekStart(monday)).toEqual(new Date('2026-08-10T00:00:00.000Z'));
  });

  it('resolves the same target week regardless of which weekday "now" falls on midweek', () => {
    const wednesday = new Date('2026-08-19T23:59:00Z');
    expect(weekStart(wednesday)).toEqual(new Date('2026-08-10T00:00:00.000Z'));
  });

  it('treats Sunday as the LAST day of its week — the Monday before a Sunday is "this week", not "last week"', () => {
    const sunday = new Date('2026-08-16T23:00:00Z'); // last day of the week starting 2026-08-10
    expect(weekStart(sunday)).toEqual(new Date('2026-08-03T00:00:00.000Z'));
  });

  it('crosses a month boundary correctly', () => {
    const monday = new Date('2026-09-07T00:00:00Z'); // Monday; previous Monday is in August
    expect(weekStart(monday)).toEqual(new Date('2026-08-31T00:00:00.000Z'));
  });

  it('crosses a year boundary correctly', () => {
    const monday = new Date('2027-01-04T00:00:00Z'); // Monday; previous Monday is in December
    expect(weekStart(monday)).toEqual(new Date('2026-12-28T00:00:00.000Z'));
  });

  it('weeksAgo = 0 resolves to the Monday of the week containing "now"', () => {
    const wednesday = new Date('2026-08-19T12:00:00Z');
    expect(weekStart(wednesday, 0)).toEqual(new Date('2026-08-17T00:00:00.000Z'));
  });

  it('weeksAgo = 2 goes back two full weeks', () => {
    const monday = new Date('2026-08-17T00:00:00Z');
    expect(weekStart(monday, 2)).toEqual(new Date('2026-08-03T00:00:00.000Z'));
  });

  it('the cron ("now" = a Monday) and a manual midweek run agree on the same target week', () => {
    const cronNow = new Date('2026-08-17T06:00:00Z'); // Monday morning cron
    const manualNow = new Date('2026-08-20T15:30:00Z'); // Thursday, same week, manual run
    expect(weekStart(cronNow)).toEqual(weekStart(manualNow));
  });
});
