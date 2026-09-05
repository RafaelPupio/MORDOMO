import { describe, expect, it, vi } from 'vitest';
import { extractEvents } from '@/agent/extractor';
import { CHURCH_TIMEZONE_NOTE } from '@/agent/time-convention';
import { verifyEvents } from '@/agent/verifier';
import { createTestDb, seedChurch } from '../helpers/db';

// Same module-level mock as extractor.test.ts / verifier.test.ts: generateObject delegates
// to the real implementation, so the calls below still run through the SDK. What these
// tests read is the `system` string each agent handed it.
const generateObjectMock = vi.hoisted(() => vi.fn());
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  generateObjectMock.mockImplementation(actual.generateObject);
  return { ...actual, generateObject: generateObjectMock };
});

async function objectModel(payload: unknown) {
  const { MockLanguageModelV3 } = await import('ai/test');
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 30, text: 30, reasoning: undefined },
      },
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      warnings: [],
    }),
  });
}

const TEXT = '## Batismos — 29/11 (domingo)\n\nOs batismos acontecem no culto das 10h.';

const CANDIDATE = {
  title: 'Batismos',
  // 10h local is 13:00Z. Before the fix this correct conversion was what the verifier
  // rejected, every time, as a three-hour shift.
  startsAt: '2026-11-29T13:00:00Z',
  location: null,
  description: null,
  confidence: 0.9,
  sourceQuote: 'Os batismos acontecem no culto das 10h.',
};

function systemPromptsSeen(): string[] {
  return generateObjectMock.mock.calls.map((c) => String((c[0] as { system?: string }).system ?? ''));
}

// The extractor converts local time to UTC; the verifier judges whether the result matches
// the document. If only one of them states that convention, the other cannot help but be
// wrong — which is exactly what happened in production on 2026-09-05, where seven correct
// candidates were rejected with notes citing "deslocamento de 3 horas".
//
// A stubbed model returns whatever verdict the test dictates, so no assertion on the
// VERDICT can catch this class of bug. The invariant that is checkable offline is that
// both agents are told the same thing.
describe('the extractor and the verifier share one time convention', () => {
  it('states the conversion in the extractor prompt', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    generateObjectMock.mockClear();

    await extractEvents(
      { db, model: await objectModel({ events: [CANDIDATE] }) },
      { churchId: church.id, documentId: church.id, text: TEXT, referenceDate: '2026-09-05' },
    );

    expect(systemPromptsSeen()[0]).toContain(CHURCH_TIMEZONE_NOTE);
  });

  it('states the same conversion in the verifier prompt', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    generateObjectMock.mockClear();

    await verifyEvents(
      { db, model: await objectModel({ decision: 'confirmed', note: 'ok' }) },
      { churchId: church.id, documentId: church.id, text: TEXT, events: [CANDIDATE] },
    );

    expect(systemPromptsSeen()[0]).toContain(CHURCH_TIMEZONE_NOTE);
  });

  it('tells the verifier that a converted time is not a shifted one', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    generateObjectMock.mockClear();

    await verifyEvents(
      { db, model: await objectModel({ decision: 'confirmed', note: 'ok' }) },
      { churchId: church.id, documentId: church.id, text: TEXT, events: [CANDIDATE] },
    );

    // The prompt still instructs it to reject a shifted date, so it must also say plainly
    // that applying the offset is not a shift — otherwise the two lines contradict.
    expect(systemPromptsSeen()[0]).toMatch(/before judging the time/i);
  });
});
