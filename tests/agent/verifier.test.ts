import { describe, expect, it, vi } from 'vitest';
import type { ExtractedEvent } from '@/agent/extractor';
import { verifyEvents } from '@/agent/verifier';
import { usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

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
    const church = await seedChurch(db);
    const model = await verdictModel([
      { decision: 'confirmed', note: 'Data e local conferem com o documento.' },
      { decision: 'rejected', note: 'O documento nao menciona este evento.' },
    ]);

    const out = await verifyEvents({ db, model }, {
      churchId: church.id,
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
    const church = await seedChurch(db);
    let called = false;
    const { MockLanguageModelV3 } = await import('ai/test');
    const model = new MockLanguageModelV3({
      doGenerate: async () => { called = true; throw new Error('should not be called'); },
    });
    const out = await verifyEvents({ db, model }, {
      churchId: church.id, documentId: crypto.randomUUID(), text: TEXT, events: [],
    });
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });

  it('rejects — never silently confirms — an event whose verification call fails', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const { MockLanguageModelV3 } = await import('ai/test');
    const model = new MockLanguageModelV3({
      doGenerate: async () => { throw new Error('gateway down'); },
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await verifyEvents({ db, model }, {
      churchId: church.id, documentId: crypto.randomUUID(), text: TEXT, events: [candidate()],
    });
    expect(out).toHaveLength(1);
    expect(out[0].verdict.decision).toBe('rejected');
    expect(out[0].verdict.note).toMatch(/falhou|failed/i);
    spy.mockRestore();
  });
});
