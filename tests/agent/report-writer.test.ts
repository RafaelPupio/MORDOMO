import { describe, expect, it, vi } from 'vitest';
import type { WeekFindings } from '@/agent/analyst';
import { writeReport } from '@/agent/report-writer';
import type { WeekActivity } from '@/core/week-activity';
import { usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

// Same mock-model shape used by tests/agent/analyst.test.ts and
// tests/agent/reply-drafter.test.ts: this installed SDK version's LanguageModelV3Usage
// requires cacheRead/cacheWrite on inputTokens and reasoning on outputTokens as present
// keys (each typed `number | undefined`, but the key itself is not optional) — omitting
// them type-checks under vitest's transform-only run but fails `tsc --noEmit`.
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

function activity(overrides: Partial<WeekActivity> = {}): WeekActivity {
  return {
    periodStart: new Date('2026-08-10T00:00:00Z'),
    periodEnd: new Date('2026-08-17T00:00:00Z'),
    visitorQuestions: [],
    prayerRequests: [],
    ticketTopics: [],
    counts: { conversations: 10, visitorMessages: 42, prayerRequests: 5, tickets: 2 },
    costUsd: 0,
    ...overrides,
  };
}

const FINDINGS: WeekFindings = {
  topQuestions: [{ question: 'Qual o horário do culto de domingo?', count: 5 }],
  unansweredQuestions: ['Vocês têm estacionamento?'],
  prayerThemes: [{ theme: 'saúde', count: 3 }, { theme: 'família', count: 2 }],
  notableTickets: ['Pedido de visita pastoral'],
  summaryStat: '42 conversas, 5 pedidos de oração e 2 tickets abertos nesta semana.',
};

describe('writeReport', () => {
  it('produces Portuguese prose from findings and meters one report.write call', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db, 'Igreja da Colina');
    const model = await textModel(
      '## Resumo da Semana — Igreja da Colina\n\nCinco pessoas perguntaram sobre o horário do culto de domingo.',
    );

    const body = await writeReport(
      { db, model },
      { churchId: church.id, churchName: church.name, findings: FINDINGS, activity: activity() },
    );

    expect(body).toContain('Resumo da Semana');
    const ledger = await db.select().from(usageLedger);
    const rows = ledger.filter((u) => u.feature === 'report.write');
    expect(rows).toHaveLength(1);
    expect(rows[0].inputTokens).toBeGreaterThan(0);
  });

  it('returns an empty string and logs, without throwing, when the model call fails', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const { MockLanguageModelV3 } = await import('ai/test');
    const model = new MockLanguageModelV3({ doGenerate: async () => { throw new Error('gateway down'); } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const body = await writeReport(
      { db, model },
      { churchId: church.id, churchName: church.name, findings: FINDINGS, activity: activity() },
    );

    expect(body).toBe('');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // Proves both halves of the privacy rule at once: the findings actually reach the
  // prompt (so the writer has something to work from), and the raw activity samples —
  // the very free-text visitor questions, prayer requests, and ticket topics the analyst
  // was supposed to have already scrubbed into aggregate findings — never do, even
  // though `activity` is part of `writeReport`'s input type. Only `activity.periodStart`
  // /`periodEnd`/`counts` (aggregate numbers, not text) are meant to reach the prompt.
  it('sends the analyst findings to the model, and never the raw activity samples', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const { MockLanguageModelV3 } = await import('ai/test');
    const capturingModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        content: [{ type: 'text', text: 'ok' }],
        warnings: [],
      }),
    });

    const distinctiveFindings: WeekFindings = {
      ...FINDINGS,
      notableTickets: ['MARCADOR_DISTINTIVO_7X9Q'],
    };
    const rawActivity = activity({
      visitorQuestions: ['RAW_VISITOR_MARKER_1'],
      prayerRequests: ['RAW_PRAYER_MARKER_2'],
      ticketTopics: ['RAW_TICKET_MARKER_3'],
    });

    await writeReport(
      { db, model: capturingModel },
      { churchId: church.id, churchName: church.name, findings: distinctiveFindings, activity: rawActivity },
    );

    expect(capturingModel.doGenerateCalls).toHaveLength(1);
    const sentToModel = JSON.stringify(capturingModel.doGenerateCalls[0].prompt);
    expect(sentToModel).toContain('MARCADOR_DISTINTIVO_7X9Q');
    expect(sentToModel).not.toContain('RAW_VISITOR_MARKER_1');
    expect(sentToModel).not.toContain('RAW_PRAYER_MARKER_2');
    expect(sentToModel).not.toContain('RAW_TICKET_MARKER_3');
  });

  it('does not discard a successful draft when the ledger write fails', async () => {
    const db = await createTestDb();
    const model = await textModel('Resumo da semana.');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // churchId never seeded -> usage_ledger insert violates the FK on church_id ->
    // recordUsage throws, same trigger tests/agent/analyst.test.ts uses.
    const body = await writeReport(
      { db, model },
      { churchId: crypto.randomUUID(), churchName: 'Igreja Fantasma', findings: FINDINGS, activity: activity() },
    );

    expect(body).toBe('Resumo da semana.');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
