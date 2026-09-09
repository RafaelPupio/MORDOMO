import { describe, expect, it } from 'vitest';
import { secretaryTools } from '@/agent/secretary';
import { HashEmbedder } from '@/ai/embedder';
import { runIngest } from '@/core/ingest';
import { ensureConversation } from '@/db/repo/chat';
import { createDocument } from '@/db/repo/documents';
import { organizations } from '@/db/schema';
import { createTestDb } from '../helpers/db';

// The installed `ai` version types a tool's `execute` return as
// `AsyncIterable<OUTPUT> | PromiseLike<OUTPUT> | OUTPUT` (streaming tool results are
// supported in general), so `await execute(...)` types as `OUTPUT | AsyncIterable<OUTPUT>`.
// Neither tool exercised below ever returns an async iterable; narrow the awaited result
// back to OUTPUT for the assertions, same as tests/agent/secretary.test.ts.
type ToolOutput<T> = T extends (...args: never[]) => infer R ? Exclude<Awaited<R>, AsyncIterable<unknown>> : never;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// `listUpcomingEvents` (behind tools.getCalendar) filters on `now = new Date()` at call
// time, so a hardcoded fixture date eventually lands in the past relative to whenever this
// suite runs and the calendar assertion would fail. Deriving the event date from "the next
// December 20th after right now" keeps it perpetually in the future without weakening the
// assertion — the event still has to genuinely be there, on a real date the pipeline
// actually parsed out of the document.
function nextDec20At19Brt(): Date {
  const now = new Date();
  const year = now.getUTCFullYear();
  // 19h America/Sao_Paulo (UTC-3) == 22h UTC, matching the bulletin's own "às 19h".
  let candidate = new Date(Date.UTC(year, 11, 20, 22, 0, 0));
  if (candidate.getTime() <= now.getTime()) {
    candidate = new Date(Date.UTC(year + 1, 11, 20, 22, 0, 0));
  }
  return candidate;
}

const EVENT_DATE = nextDec20At19Brt();
// Fixed at day=20, month=12 regardless of which year nextDec20At19Brt() landed on.
const EVENT_DDMM = `${pad2(EVENT_DATE.getUTCDate())}/${pad2(EVENT_DATE.getUTCMonth() + 1)}`;
const DEADLINE_DATE = new Date(EVENT_DATE.getTime());
DEADLINE_DATE.setUTCDate(DEADLINE_DATE.getUTCDate() - 7);
const DEADLINE_DDMM = `${pad2(DEADLINE_DATE.getUTCDate())}/${pad2(DEADLINE_DATE.getUTCMonth() + 1)}`;
// "Today" for the extractor's relative-date resolution — the bulletin is being ingested now.
const REFERENCE_DATE = new Date().toISOString().slice(0, 10);

const BULLETIN = [
  '# Boletim Informativo',
  '',
  '> Igreja da Colina — igreja fictícia, criada para demonstração.',
  '',
  `## Ceia de Natal da igreja — ${EVENT_DDMM} (domingo)`,
  '',
  `A ceia de Natal acontece no dia ${EVENT_DDMM}, às 19h, no salão comunitário.`,
  `Inscrições com a secretaria até ${DEADLINE_DDMM}.`,
].join('\n');

async function objectModel(payloads: unknown[]) {
  const { MockLanguageModelV3 } = await import('ai/test');
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 30, text: 30, reasoning: undefined },
      },
      content: [{ type: 'text', text: JSON.stringify(payloads[Math.min(call++, payloads.length - 1)]) }],
      warnings: [],
    }),
  });
}

describe('ingest → answer', () => {
  it('a freshly ingested bulletin is retrievable by the secretary and its event reaches the calendar', async () => {
    const db = await createTestDb();
    const [church] = await db.insert(organizations).values({ slug: 'demo', name: 'Igreja da Colina' }).returning();
    const doc = await createDocument(db, { organizationId: church.id, title: 'Boletim de Novembro', kind: 'bulletin' });

    const result = await runIngest(
      {
        db,
        embedder: new HashEmbedder(),
        extractorModel: await objectModel([{
          events: [{
            title: 'Ceia de Natal da igreja',
            startsAt: EVENT_DATE.toISOString(),
            location: 'Salão comunitário',
            description: `Inscrições até ${DEADLINE_DDMM}`,
            confidence: 0.95,
            sourceQuote: `Ceia de Natal da igreja — ${EVENT_DDMM} (domingo)`,
          }],
        }]),
        verifierModel: await objectModel([{ decision: 'confirmed', note: 'Data e local conferem.' }]),
      },
      {
        organizationId: church.id, documentId: doc.id,
        bytes: new TextEncoder().encode(BULLETIN), mimeType: 'text/markdown',
        referenceDate: REFERENCE_DATE,
      },
    );

    expect(result.status).toBe('published');
    expect(result.published).toBe(1);

    const conversationId = crypto.randomUUID();
    await ensureConversation(db, { id: conversationId, organizationId: church.id, visitorKey: 'e2e' });
    const tools = secretaryTools(
      { db, embedder: new HashEmbedder() },
      { organizationId: church.id, conversationId },
    );

    // The knowledge base answers from the newly ingested document...
    const search = (await tools.searchKnowledge.execute!(
      { query: 'quando é a ceia de natal?' },
      {} as never,
    )) as ToolOutput<typeof tools.searchKnowledge.execute>;
    expect(search.sources.length).toBeGreaterThan(0);
    expect(search.sources[0].documentTitle).toBe('Boletim de Novembro');
    expect(search.sources[0].excerpt).toContain(EVENT_DDMM);

    // ...and the verified event is on the calendar the agent reads.
    const calendar = (await tools.getCalendar.execute!(
      {},
      {} as never,
    )) as ToolOutput<typeof tools.getCalendar.execute>;
    const titles = calendar.events.map((e: { title: string }) => e.title);
    expect(titles).toContain('Ceia de Natal da igreja');
  });
});
