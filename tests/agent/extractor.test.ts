import { describe, expect, it, vi } from 'vitest';
import { extractEvents } from '@/agent/extractor';
import { CHAT_MODEL } from '@/ai/pricing';
import { usageLedger } from '@/db/schema';
import { createTestDb, seedOrganization } from '../helpers/db';

// generateObject is mocked at the module level, by default delegating to the real
// implementation, so most tests below still exercise the SDK's actual parsing/validation
// path (via MockLanguageModelV3, same as before). Two tests override it for a single call
// via mockRejectedValueOnce/mockResolvedValueOnce, to reach paths a mock LanguageModel
// can't: a total call failure, and a plain *string* deps.model. A string model id resolves
// through the AI SDK's global gateway provider — which would mean real network access in
// this test — so we bypass generateObject's model resolution entirely instead, the same
// reason secretary.test.ts tests `priceableModelId` as a pure function rather than routing
// a string model through streamText.
const generateObjectMock = vi.hoisted(() => vi.fn());
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  generateObjectMock.mockImplementation(actual.generateObject);
  return { ...actual, generateObject: generateObjectMock };
});

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
    const church = await seedOrganization(db);
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
      organizationId: church.id,
      documentId: crypto.randomUUID(),
      text: TEXT,
      referenceDate: '2026-10-01',
    });

    expect(out.failed).toBe(false);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].title).toBe('Encontro de jovens OTB');
    expect(out.candidates[0].sourceQuote).toContain('Encontro de jovens');
    const ledger = await db.select().from(usageLedger);
    expect(ledger.some((u) => u.feature === 'ingest.extract' && u.inputTokens > 0)).toBe(true);
  });

  it('returns an empty array when the document has no events', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const model = await objectModel({ events: [] });
    const out = await extractEvents({ db, model }, {
      organizationId: church.id, documentId: crypto.randomUUID(),
      text: 'Palavra pastoral sobre gratidão.', referenceDate: '2026-10-01',
    });
    expect(out).toEqual({ candidates: [], failed: false });
  });

  it('drops events whose quote is not present in the source text', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const model = await objectModel({
      events: [
        { title: 'Real', startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
          confidence: 0.9, sourceQuote: 'Encontro de jovens OTB' },
        { title: 'Inventado', startsAt: '2026-11-01T12:00:00Z', location: null, description: null,
          confidence: 0.9, sourceQuote: 'esta frase nao existe no documento' },
      ],
    });
    const out = await extractEvents({ db, model }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01',
    });
    expect(out.candidates.map((e) => e.title)).toEqual(['Real']);
  });

  it('drops events with an unparseable date', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const model = await objectModel({
      events: [{ title: 'Sem data', startsAt: 'quando der', location: null, description: null,
        confidence: 0.8, sourceQuote: 'Encontro de jovens OTB' }],
    });
    const out = await extractEvents({ db, model }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01',
    });
    expect(out.candidates).toEqual([]);
  });

  // Minor finding: `Date.parse` alone accepts partial values like "2026" and "Jan 2026"
  // (both resolve to Jan 1, midnight UTC), which is not what the extractor's own system
  // prompt asks for ("Data e hora de início em ISO 8601 (UTC)"). A partial date must be
  // dropped here, before it costs a verifier call it could never survive on the merits.
  it('drops events whose date is only a partial value ("2026", "Jan 2026"), not a full date-and-time', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const model = await objectModel({
      events: [
        { title: 'Só o ano', startsAt: '2026', location: null, description: null,
          confidence: 0.8, sourceQuote: 'Encontro de jovens OTB' },
        { title: 'Mês por extenso', startsAt: 'Jan 2026', location: null, description: null,
          confidence: 0.8, sourceQuote: 'Encontro de jovens OTB' },
        { title: 'Só a data, sem hora', startsAt: '2026-10-10', location: null, description: null,
          confidence: 0.8, sourceQuote: 'Encontro de jovens OTB' },
      ],
    });
    const out = await extractEvents({ db, model }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01',
    });
    expect(out.candidates).toEqual([]);
  });

  it('does not fail the extraction when the ledger write throws', async () => {
    const db = await createTestDb();
    const model = await objectModel({
      events: [{ title: 'Real', startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
        confidence: 0.9, sourceQuote: 'Encontro de jovens OTB' }],
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await extractEvents(
      { db, model },
      { organizationId: crypto.randomUUID(), documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01' },
    );
    expect(out.candidates).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // Finding 1a: `generateObject` validates the WHOLE `{ events: [...] }` payload in one
  // shot. Before the fix, `confidence: 1.5` failing the schema's `.min/.max` bound threw
  // NoObjectGeneratedError for the entire batch, silently discarding every legitimate
  // candidate alongside the bad one. The schema now accepts any number and we clamp it
  // ourselves per candidate, so one out-of-range field can no longer sink the batch.
  it('keeps every candidate when one has an out-of-range confidence, clamping it into 0..1', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const model = await objectModel({
      events: [
        { title: 'Confiança fora da faixa', startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
          confidence: 1.5, sourceQuote: 'Encontro de jovens OTB' },
        { title: 'Confiança normal', startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
          confidence: 0.9, sourceQuote: 'Encontro de jovens OTB' },
      ],
    });
    const out = await extractEvents({ db, model }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01',
    });
    expect(out.candidates).toHaveLength(2);
    expect(out.candidates.find((e) => e.title === 'Confiança fora da faixa')?.confidence).toBe(1);
    expect(out.candidates.find((e) => e.title === 'Confiança normal')?.confidence).toBe(0.9);
  });

  // Finding 1b: a total `generateObject` failure (network error, output the SDK could
  // not repair) must not throw out of extractEvents — the surrounding ingest pipeline
  // still needs to publish the document's chunks even with zero extracted events. C1:
  // this failure must ALSO be distinguishable from a clean "no events" result, via
  // `failed: true` — a caller (src/core/ingest.ts) relies on that distinction to avoid
  // treating an outage as "nothing to publish".
  it('returns failed: true with no candidates, and logs, when generateObject fails entirely', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    generateObjectMock.mockRejectedValueOnce(new Error('network unreachable'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await extractEvents({ db }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01',
    });
    expect(out).toEqual({ candidates: [], failed: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // Finding 2: the quote guard must tolerate the typography drift a model commonly
  // introduces when "copying" text — an em dash retyped as a hyphen, curly quotes
  // straightened, an accent dropped — without becoming a fuzzy match.
  it('accepts quotes that differ from the source only by em dash, curly apostrophe, or stripped accent', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const text = 'Encontro de jovens — sábado (10/10), na sala ‘Boas-vindas’, às 19h.';
    const model = await objectModel({
      events: [
        { title: 'Travessão como hífen e acento removido', startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
          confidence: 0.9, sourceQuote: 'Encontro de jovens - sabado (10/10)' },
        { title: 'Aspas retas em vez de curvas', startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
          confidence: 0.9, sourceQuote: "sala 'Boas-vindas'" },
      ],
    });
    const out = await extractEvents({ db, model }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text, referenceDate: '2026-10-01',
    });
    expect(out.candidates.map((e) => e.title)).toEqual([
      'Travessão como hífen e acento removido',
      'Aspas retas em vez de curvas',
    ]);
  });

  // Companion to the drift test above: widening the normalization must not turn the
  // guard into a fuzzy/substring-of-anything check. An empty or whitespace-only quote,
  // and a quote that genuinely does not occur in the document, must still be rejected.
  it('still rejects an empty or whitespace-only sourceQuote', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const model = await objectModel({
      events: [
        { title: 'Vazio', startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
          confidence: 0.9, sourceQuote: '' },
        { title: 'Só espaços', startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
          confidence: 0.9, sourceQuote: '   ' },
      ],
    });
    const out = await extractEvents({ db, model }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01',
    });
    expect(out.candidates).toEqual([]);
  });

  // Finding 3: `recordUsage` used to hardcode `model: FAST_MODEL` regardless of the model
  // actually used via deps.model. A string deps.model resolves through the AI SDK's
  // global gateway provider (real network), so this bypasses generateObject's model
  // resolution via the module mock instead of routing a string through a live call.
  it('prices the ledger row under the actual string model id passed via deps.model, not the FAST_MODEL default', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    generateObjectMock.mockResolvedValueOnce({
      object: { events: [] },
      usage: { inputTokens: 42, outputTokens: 7 },
    });
    const out = await extractEvents({ db, model: CHAT_MODEL }, {
      organizationId: church.id, documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01',
    });
    expect(out.candidates).toEqual([]);
    const ledger = await db.select().from(usageLedger);
    const row = ledger.find((u) => u.feature === 'ingest.extract');
    expect(row?.model).toBe(CHAT_MODEL);
  });
});
