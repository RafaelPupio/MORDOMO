import { describe, expect, it, vi } from 'vitest';
import { extractEvents } from '@/agent/extractor';
import { usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

// generateObject is exercised through a mock model that returns the JSON the schema
// expects, so the test verifies OUR contract (shape, defaults, metering, error
// handling), not the SDK's.
//
// Adapted from the brief's fixture: this installed SDK version's LanguageModelV3Usage
// requires cacheRead/cacheWrite on inputTokens and reasoning on outputTokens as present
// keys (each typed `number | undefined`, but the key itself is not optional) — omitting
// them type-checks under vitest's transform-only run but fails `tsc --noEmit`. Same
// nested-usage shape already verified working in tests/channels/web.test.ts.
async function objectModel(payload: unknown) {
  const { MockLanguageModelV3 } = await import('ai/test');
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 40, text: 40, reasoning: undefined },
      },
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      warnings: [],
    }),
  });
}

const TEXT = '## Encontro de jovens OTB — 10/10 (sábado)\n\nÀs 19h, na quadra coberta.';

describe('extractEvents', () => {
  it('returns the extracted events and meters the call', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await objectModel({
      events: [{
        title: 'Encontro de jovens OTB',
        startsAt: '2026-10-10T22:00:00Z',
        location: 'Quadra coberta',
        description: 'Tema: Fé e vocação',
        confidence: 0.9,
        sourceQuote: 'Encontro de jovens OTB — 10/10 (sábado)',
      }],
    });

    const out = await extractEvents({ db, model }, {
      churchId: church.id,
      documentId: crypto.randomUUID(),
      text: TEXT,
      referenceDate: '2026-10-01',
    });

    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Encontro de jovens OTB');
    expect(out[0].sourceQuote).toContain('Encontro de jovens');
    const ledger = await db.select().from(usageLedger);
    expect(ledger.some((u) => u.feature === 'ingest.extract' && u.inputTokens > 0)).toBe(true);
  });

  it('returns an empty array when the document has no events', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await objectModel({ events: [] });
    const out = await extractEvents({ db, model }, {
      churchId: church.id, documentId: crypto.randomUUID(),
      text: 'Palavra pastoral sobre gratidão.', referenceDate: '2026-10-01',
    });
    expect(out).toEqual([]);
  });

  it('drops events whose quote is not present in the source text', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await objectModel({
      events: [
        { title: 'Real', startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
          confidence: 0.9, sourceQuote: 'Encontro de jovens OTB' },
        { title: 'Inventado', startsAt: '2026-11-01T12:00:00Z', location: null, description: null,
          confidence: 0.9, sourceQuote: 'esta frase nao existe no documento' },
      ],
    });
    const out = await extractEvents({ db, model }, {
      churchId: church.id, documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01',
    });
    expect(out.map((e) => e.title)).toEqual(['Real']);
  });

  it('drops events with an unparseable date', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await objectModel({
      events: [{ title: 'Sem data', startsAt: 'quando der', location: null, description: null,
        confidence: 0.8, sourceQuote: 'Encontro de jovens OTB' }],
    });
    const out = await extractEvents({ db, model }, {
      churchId: church.id, documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01',
    });
    expect(out).toEqual([]);
  });

  it('does not fail the extraction when the ledger write throws', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await objectModel({
      events: [{ title: 'Real', startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
        confidence: 0.9, sourceQuote: 'Encontro de jovens OTB' }],
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await extractEvents(
      { db, model },
      { churchId: crypto.randomUUID(), documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01' },
    );
    expect(out).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
