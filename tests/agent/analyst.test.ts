import { describe, expect, it, vi } from 'vitest';
import { analyzeWeek } from '@/agent/analyst';
import { CHAT_MODEL } from '@/ai/pricing';
import type { WeekActivity } from '@/core/week-activity';
import { usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

// generateObject is mocked at the module level, by default delegating to the real
// implementation, so most tests below still exercise the SDK's actual parsing/validation
// path (via MockLanguageModelV3, same as tests/agent/extractor.test.ts and
// tests/agent/verifier.test.ts). Two tests override it for a single call via
// mockRejectedValueOnce/mockResolvedValueOnce, to reach paths a mock LanguageModel can't:
// a total call failure, and a plain *string* deps.model (which would otherwise resolve
// through the AI SDK's global gateway provider — real network — if routed through
// generateObject for real).
const generateObjectMock = vi.hoisted(() => vi.fn());
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  generateObjectMock.mockImplementation(actual.generateObject);
  return { ...actual, generateObject: generateObjectMock };
});

// Adapted from the brief's fixture: this installed SDK version's LanguageModelV3Usage
// requires cacheRead/cacheWrite on inputTokens and reasoning on outputTokens as present
// keys (each typed `number | undefined`, but the key itself is not optional) — omitting
// them type-checks under vitest's transform-only run but fails `tsc --noEmit`. Same
// nested-usage shape already verified working in tests/agent/extractor.test.ts.
async function findingsModel(payload: unknown) {
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

function activity(overrides: Partial<WeekActivity> = {}): WeekActivity {
  return {
    periodStart: new Date('2026-08-10T00:00:00Z'),
    periodEnd: new Date('2026-08-17T00:00:00Z'),
    visitorQuestions: [],
    prayerRequests: [],
    ticketTopics: [],
    counts: { conversations: 0, visitorMessages: 0, prayerRequests: 0, tickets: 0 },
    costUsd: 0,
    ...overrides,
  };
}

const FINDINGS_PAYLOAD = {
  topQuestions: [{ question: 'Qual o horário do culto de domingo?', count: 5 }],
  unansweredQuestions: ['Vocês têm estacionamento?'],
  prayerThemes: [{ theme: 'saúde', count: 3 }, { theme: 'família', count: 2 }],
  notableTickets: ['Pedido de visita pastoral'],
  summaryStat: '42 conversas, 5 pedidos de oração e 2 tickets abertos nesta semana.',
};

describe('analyzeWeek', () => {
  it('returns parsed findings for a normal week and meters one report.analyze call', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await findingsModel(FINDINGS_PAYLOAD);

    const week = activity({
      visitorQuestions: ['Qual o horário do culto de domingo?', 'Qual o horário do culto de domingo?'],
      prayerRequests: ['peço oração pela saúde da minha mãe'],
      ticketTopics: ['Pedido de visita pastoral'],
      counts: { conversations: 10, visitorMessages: 42, prayerRequests: 5, tickets: 2 },
    });

    const out = await analyzeWeek({ db, model }, { churchId: church.id, activity: week });

    expect(out).toEqual(FINDINGS_PAYLOAD);
    const ledger = await db.select().from(usageLedger);
    const rows = ledger.filter((u) => u.feature === 'report.analyze');
    expect(rows).toHaveLength(1);
    expect(rows[0].inputTokens).toBeGreaterThan(0);
  });

  it('returns null and logs, without throwing, when the model call fails', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    generateObjectMock.mockRejectedValueOnce(new Error('network unreachable'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const week = activity({
      visitorQuestions: ['Alguma pergunta'],
      counts: { conversations: 1, visitorMessages: 1, prayerRequests: 0, tickets: 0 },
    });

    const out = await analyzeWeek({ db }, { churchId: church.id, activity: week });

    expect(out).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // "Nothing happened this week" is itself a valid finding, and the digest job is not
  // expected to call analyzeWeek at all in that case — but this guard makes the
  // guarantee hold even if it is called anyway: a self-contained poison model (its own
  // doGenerate, not the shared module mock) proves the model is never reached, which is
  // a stronger assertion than merely checking the returned findings are empty.
  it('returns empty findings without calling the model when the week has no activity at all', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const { MockLanguageModelV3 } = await import('ai/test');
    const doGenerate = vi.fn().mockRejectedValue(
      new Error('generateObject must not be called for a week with no activity'),
    );
    const model = new MockLanguageModelV3({ doGenerate });

    const week = activity();

    const out = await analyzeWeek({ db, model }, { churchId: church.id, activity: week });

    expect(out).toEqual({
      topQuestions: [],
      unansweredQuestions: [],
      prayerThemes: [],
      notableTickets: [],
      summaryStat: expect.any(String),
    });
    expect(doGenerate).not.toHaveBeenCalled();
    const ledger = await db.select().from(usageLedger);
    expect(ledger.filter((u) => u.feature === 'report.analyze')).toHaveLength(0);
  });

  it('does not discard successful findings when the ledger write fails', async () => {
    const db = await createTestDb();
    const model = await findingsModel(FINDINGS_PAYLOAD);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const week = activity({
      visitorQuestions: ['Qual o horário do culto de domingo?'],
      counts: { conversations: 1, visitorMessages: 1, prayerRequests: 0, tickets: 0 },
    });

    // churchId never seeded -> usage_ledger insert violates the FK on church_id ->
    // recordUsage throws, same trigger tests/agent/extractor.test.ts uses for its
    // equivalent case.
    const out = await analyzeWeek({ db, model }, { churchId: crypto.randomUUID(), activity: week });

    expect(out).toEqual(FINDINGS_PAYLOAD);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // C1: the closed vocabulary (`z.enum(PRAYER_THEME_VALUES)`) is a STRUCTURAL defense,
  // not an advisory one. A model returning a theme that leaks a name and a diagnosis
  // cannot express that inside `prayerThemes.theme` — the value simply doesn't validate
  // against the enum, `generateObject` throws for the WHOLE payload, and `analyzeWeek`'s
  // existing null-on-failure path takes over. This is the reviewer's exact probe: the
  // identifying string must never reach the returned findings, in any form.
  it('a theme that leaks identifying detail (the reviewer\'s exact probe) cannot reach the returned findings — fails closed to null', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const leaking = 'Maria pede oração porque o marido dela tem câncer';
    const model = await findingsModel({
      ...FINDINGS_PAYLOAD,
      prayerThemes: [{ theme: leaking, count: 1 }],
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const week = activity({
      prayerRequests: ['peço oração pela saúde do meu esposo'],
      counts: { conversations: 1, visitorMessages: 0, prayerRequests: 1, tickets: 0 },
    });

    const out = await analyzeWeek({ db, model }, { churchId: church.id, activity: week });

    expect(out).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // C1 fallback handling + I2: an off-vocabulary theme that is NOT identifying (just
  // outside the fixed list) is rejected the same structural way — the whole call fails
  // closed to null, by deliberate design (see the trade-off comment on
  // `findingsSchema.prayerThemes` in src/agent/analyst.ts). The real, billable usage the
  // model call incurred (300 in / 120 out, same numbers the reviewer measured) must still
  // land in usage_ledger — a malformed-output call still cost money — per the
  // NoObjectGeneratedError precedent already in src/agent/extractor.ts.
  it('rejects an off-vocabulary theme by failing closed to null, and still meters the real usage spent on the failed call', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await findingsModel({
      ...FINDINGS_PAYLOAD,
      prayerThemes: [{ theme: 'clima', count: 1 }], // not a member of PRAYER_THEME_VALUES
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const week = activity({
      prayerRequests: ['pedido qualquer'],
      counts: { conversations: 1, visitorMessages: 0, prayerRequests: 1, tickets: 0 },
    });

    const out = await analyzeWeek({ db, model }, { churchId: church.id, activity: week });

    expect(out).toBeNull();
    const ledger = await db.select().from(usageLedger);
    const rows = ledger.filter((u) => u.feature === 'report.analyze');
    expect(rows).toHaveLength(1);
    expect(rows[0].inputTokens).toBe(300);
    expect(rows[0].outputTokens).toBe(120);
    spy.mockRestore();
  });

  // I3: `count` is left unbounded in the schema (see the comment in src/agent/analyst.ts)
  // so one bad count can't invalidate the whole week's findings, and is clamped to a
  // non-negative integer post-hoc instead — same precedent as `confidence` in
  // src/agent/extractor.ts.
  it('clamps negative, absurd, and non-integer counts to non-negative integers', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await findingsModel({
      ...FINDINGS_PAYLOAD,
      topQuestions: [
        { question: 'pergunta negativa', count: -5 },
        { question: 'pergunta absurda', count: Number.MAX_SAFE_INTEGER },
        { question: 'pergunta fracionada', count: 3.7 },
      ],
      prayerThemes: [{ theme: 'saúde', count: -2 }],
    });

    const week = activity({
      visitorQuestions: ['pergunta negativa', 'pergunta absurda', 'pergunta fracionada'],
      prayerRequests: ['pedido de saúde'],
      counts: { conversations: 1, visitorMessages: 3, prayerRequests: 1, tickets: 0 },
    });

    const out = await analyzeWeek({ db, model }, { churchId: church.id, activity: week });

    expect(out).not.toBeNull();
    expect(out!.topQuestions.every((q) => Number.isInteger(q.count) && q.count >= 0)).toBe(true);
    expect(out!.topQuestions.find((q) => q.question === 'pergunta negativa')?.count).toBe(0);
    expect(out!.topQuestions.find((q) => q.question === 'pergunta fracionada')?.count).toBe(4);
    expect(out!.topQuestions.find((q) => q.question === 'pergunta absurda')?.count).toBe(Number.MAX_SAFE_INTEGER);
    expect(out!.prayerThemes[0].count).toBe(0);
  });

  it('prices the ledger row under the actual string model id passed via deps.model, not the FAST_MODEL default', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    generateObjectMock.mockResolvedValueOnce({
      object: FINDINGS_PAYLOAD,
      usage: { inputTokens: 42, outputTokens: 7 },
    });

    const week = activity({
      visitorQuestions: ['pergunta'],
      counts: { conversations: 1, visitorMessages: 1, prayerRequests: 0, tickets: 0 },
    });

    const out = await analyzeWeek({ db, model: CHAT_MODEL }, { churchId: church.id, activity: week });

    expect(out).toEqual(FINDINGS_PAYLOAD);
    const ledger = await db.select().from(usageLedger);
    const row = ledger.find((u) => u.feature === 'report.analyze');
    expect(row?.model).toBe(CHAT_MODEL);
  });
});
