import { describe, expect, it, vi } from 'vitest';
import { extractEvents, MAX_EXTRACTED_EVENTS } from '@/agent/extractor';
import { MAX_CANDIDATES } from '@/core/ingest';
import { createTestDb, seedChurch } from '../helpers/db';

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

// The first production load test (235 pages) made the extractor emit events until
// maxOutputTokens cut the JSON mid-string, so the document published with zero events.
// The cap is the one thing checkable offline: the prompt must state it, and it must be the
// number the verifier stage will actually accept.
describe('the extractor is asked for a bounded list', () => {
  it('states the cap in its prompt, with the same number the verifier stage keeps', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    generateObjectMock.mockClear();

    await extractEvents(
      { db, model: await objectModel({ events: [] }) },
      { churchId: church.id, documentId: church.id, text: '## Culto — 12/12\n\nÀs 19h30.', referenceDate: '2026-09-05' },
    );

    const system = String((generateObjectMock.mock.calls[0][0] as { system?: string }).system);
    expect(system).toContain(`Return at most ${MAX_EXTRACTED_EVENTS} events`);
    expect(system).toMatch(/start soonest on or after the reference date/);
    expect(MAX_CANDIDATES).toBe(MAX_EXTRACTED_EVENTS);
  });
});
