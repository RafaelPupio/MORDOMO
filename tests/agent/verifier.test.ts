import { describe, expect, it, vi } from 'vitest';
import type { ExtractedEvent } from '@/agent/extractor';
import { verifyEvents, VERIFY_CONCURRENCY } from '@/agent/verifier';
import { CHAT_MODEL } from '@/ai/pricing';
import { usageLedger } from '@/db/schema';
import { createTestDb, seedOrganization } from '../helpers/db';

// generateObject is mocked at the module level, by default delegating to the real
// implementation (same pattern as tests/agent/extractor.test.ts's `generateObjectMock`),
// so every other test in this file still exercises the actual generateObject path via
// MockLanguageModelV3. The one override below (mockResolvedValueOnce) reaches a path a
// mock LanguageModel can't: a plain *string* deps.model, which resolves through the AI
// SDK's global gateway provider (real network) if routed through generateObject for real.
const generateObjectMock = vi.hoisted(() => vi.fn());
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  generateObjectMock.mockImplementation(actual.generateObject);
  return { ...actual, generateObject: generateObjectMock };
});

async function verdictModel(verdicts: { decision: string; note: string }[]) {
  const { MockLanguageModelV3 } = await import('ai/test');
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const v = verdicts[Math.min(call++, verdicts.length - 1)];
      return {
        finishReason: { unified: 'stop', raw: 'stop' },
        // This installed SDK version's LanguageModelV3Usage requires cacheRead/cacheWrite
        // on inputTokens and reasoning on outputTokens as present keys (each typed
        // `number | undefined`, but the key itself is not optional) — omitting them
        // type-checks under vitest's transform-only run but fails `tsc --noEmit`.
        // Same shape already verified working in tests/agent/extractor.test.ts.
        usage: {
          inputTokens: { total: 80, noCache: 80, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        content: [{ type: 'text', text: JSON.stringify(v) }],
        warnings: [],
      };
    },
  });
}

const TEXT = '## Encontro de jovens OTB — 10/10 (sábado)\n\nÀs 19h, na quadra coberta.';

function candidate(overrides: Partial<ExtractedEvent> = {}): ExtractedEvent {
  return {
    title: 'Encontro de jovens OTB',
    startsAt: '2026-10-10T22:00:00Z',
    location: 'Quadra coberta',
    description: null,
    confidence: 0.9,
    sourceQuote: 'Encontro de jovens OTB — 10/10 (sábado)',
    ...overrides,
  };
}

describe('verifyEvents', () => {
  it('attaches a verdict to each candidate and meters one call per event', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const model = await verdictModel([
      { decision: 'confirmed', note: 'Data e local conferem com o documento.' },
      { decision: 'rejected', note: 'O documento nao menciona este evento.' },
    ]);

    const out = await verifyEvents({ db, model }, {
      organizationId: church.id,
      documentId: crypto.randomUUID(),
      text: TEXT,
      events: [candidate(), candidate({ title: 'Outro' })],
    });

    expect(out.map((e) => e.verdict.decision)).toEqual(['confirmed', 'rejected']);
    expect(out[0].verdict.note).toContain('conferem');
    const ledger = await db.select().from(usageLedger);
    expect(ledger.filter((u) => u.feature === 'ingest.verify')).toHaveLength(2);
  });

  it('returns an empty array without calling the model when there are no candidates', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    let called = false;
    const { MockLanguageModelV3 } = await import('ai/test');
    const model = new MockLanguageModelV3({
      doGenerate: async () => { called = true; throw new Error('should not be called'); },
    });
    const out = await verifyEvents({ db, model }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text: TEXT, events: [],
    });
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });

  // C1 depends on this outage marker to tell "the document doesn't support this
  // candidate" apart from "we couldn't check it at all" — see src/core/ingest.ts, which
  // uses `outage: true` on every verified candidate to decide whether it's still safe to
  // replace a document's previously verified events.
  it('rejects — never silently confirms — an event whose verification call fails, and marks it as an outage', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const { MockLanguageModelV3 } = await import('ai/test');
    const model = new MockLanguageModelV3({
      doGenerate: async () => { throw new Error('gateway down'); },
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await verifyEvents({ db, model }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text: TEXT, events: [candidate()],
    });
    expect(out).toHaveLength(1);
    expect(out[0].verdict.decision).toBe('rejected');
    expect(out[0].verdict.note).toMatch(/falhou|failed/i);
    expect(out[0].verdict.outage).toBe(true);
    spy.mockRestore();
  });

  // A genuine, model-produced rejection (the document really doesn't support the
  // candidate) must NOT carry the outage marker — only the catch-block path does.
  it('does not mark a genuine model-produced rejection as an outage', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const model = await verdictModel([{ decision: 'rejected', note: 'O documento nao menciona este evento.' }]);
    const out = await verifyEvents({ db, model }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text: TEXT, events: [candidate()],
    });
    expect(out[0].verdict.decision).toBe('rejected');
    expect(out[0].verdict.outage).toBeUndefined();
  });

  // I5: `recordUsage` used to hardcode `model: FAST_MODEL` regardless of the model
  // actually used via deps.model, mirroring the same bug already fixed in the extractor
  // (tests/agent/extractor.test.ts). A string deps.model resolves through the AI SDK's
  // global gateway provider (real network), so this bypasses generateObject's model
  // resolution via the module mock instead of routing a string through a live call.
  it('prices the ledger row under the actual string model id passed via deps.model, not a hardcoded FAST_MODEL', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    generateObjectMock.mockResolvedValueOnce({
      object: { decision: 'confirmed', note: 'Confere.' },
      usage: { inputTokens: 55, outputTokens: 9 },
    });
    const out = await verifyEvents({ db, model: CHAT_MODEL }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text: TEXT, events: [candidate()],
    });
    expect(out[0].verdict.decision).toBe('confirmed');
    const ledger = await db.select().from(usageLedger);
    const row = ledger.find((u) => u.feature === 'ingest.verify');
    expect(row?.model).toBe(CHAT_MODEL);
  });

  // I3: verifyEvents must bound how many calls run at once instead of firing every
  // candidate's call simultaneously via a bare Promise.all.
  it('never runs more than VERIFY_CONCURRENCY verifier calls at the same time', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const { MockLanguageModelV3 } = await import('ai/test');
    let inFlight = 0;
    let maxInFlight = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return {
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          content: [{ type: 'text', text: JSON.stringify({ decision: 'confirmed', note: 'ok' }) }],
          warnings: [],
        };
      },
    });
    const manyEvents = Array.from({ length: VERIFY_CONCURRENCY * 3 }, (_, i) => candidate({ title: `Evento ${i}` }));

    const out = await verifyEvents({ db, model }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text: TEXT, events: manyEvents,
    });

    expect(out).toHaveLength(manyEvents.length);
    expect(maxInFlight).toBeLessThanOrEqual(VERIFY_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThan(1); // still genuinely concurrent, not serialized to 1
  });
});
