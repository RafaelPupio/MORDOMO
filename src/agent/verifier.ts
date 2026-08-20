import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { ExtractedEvent } from '@/agent/extractor';
import { FAST_MODEL, priceableModelId } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import type { Db } from '@/db/client';

export type VerifierDeps = { db: Db; model?: LanguageModel };
export type VerifierInput = {
  churchId: string;
  documentId: string;
  text: string;
  events: ExtractedEvent[];
};

// `outage` is never asked of the model (it is not part of `verdictSchema` below) — it is
// a marker WE attach, only in the catch branch of `verifyEvents`, to distinguish "the
// document does not support this candidate" (a genuine, informative rejection) from "we
// could not check this candidate at all" (an outage). Both still count as `rejected` —
// an unverified event is never published either way — but only the caller in
// src/core/ingest.ts can safely decide whether it's still safe to replace a document's
// previously verified events based on THIS run's verdicts, and that decision needs the
// distinction this flag carries.
export type Verdict = { decision: 'confirmed' | 'rejected'; note: string; outage?: boolean };
export type VerifiedEvent = ExtractedEvent & { verdict: Verdict };

// Runs at most this many verifier calls concurrently instead of firing every candidate's
// call at once via `Promise.all`. This does not lower total spend (see MAX_CANDIDATES in
// src/core/ingest.ts for the actual cost bound) — it bounds burst concurrency against the
// model gateway so a document with many candidates cannot open dozens of simultaneous
// requests in one instant.
export const VERIFY_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

const verdictSchema = z.object({
  decision: z.enum(['confirmed', 'rejected']),
  note: z.string().describe('Uma frase em português explicando a decisão'),
});

// The verifier is deliberately a SEPARATE call with a separate prompt, not a second
// pass by the extractor: it is given the candidate and the source and asked to disprove
// the candidate. An extractor asked to check itself tends to agree with itself.
const SYSTEM = [
  'You audit a single candidate calendar event against the church document it was extracted from.',
  'Confirm ONLY if the document genuinely supports the title, the date, and the time. Anything the document does not state — an invented location, a shifted date, a plausible-sounding detail — means reject.',
  'Treat the candidate as a claim to be disproved, not as a summary to be agreed with.',
  'Answer with a decision and one short sentence in Portuguese explaining why.',
].join('\n');

export async function verifyEvents(
  deps: VerifierDeps,
  input: VerifierInput,
): Promise<VerifiedEvent[]> {
  if (input.events.length === 0) return [];

  const model = deps.model ?? FAST_MODEL;
  const pricedModel = priceableModelId(model, FAST_MODEL);

  return mapWithConcurrency(input.events, VERIFY_CONCURRENCY, async (event): Promise<VerifiedEvent> => {
    try {
      const { object, usage } = await generateObject({
        model,
        schema: verdictSchema,
        system: SYSTEM,
        prompt: [
          'DOCUMENTO:', input.text, '',
          'EVENTO CANDIDATO:', JSON.stringify(
            {
              title: event.title, startsAt: event.startsAt,
              location: event.location, description: event.description,
              sourceQuote: event.sourceQuote,
            }, null, 2,
          ),
        ].join('\n'),
      });

      try {
        await recordUsage(deps.db, {
          churchId: input.churchId,
          feature: 'ingest.verify',
          model: pricedModel,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        });
      } catch (error) {
        console.error('ingest.verify usage not recorded', {
          churchId: input.churchId, documentId: input.documentId, error,
        });
      }

      return { ...event, verdict: object };
    } catch (error) {
      // Fail closed: an unverified event is never published. A verification outage
      // must not become a silent path for unchecked data into the calendar. `outage:
      // true` marks this as "we could not check it" rather than "the document doesn't
      // support it" — src/core/ingest.ts uses that distinction to decide whether it's
      // still safe to replace the document's previously verified events with this run's
      // (empty-of-confirmations) result.
      console.error('ingest.verify failed; rejecting candidate', {
        churchId: input.churchId, documentId: input.documentId, title: event.title, error,
      });
      return {
        ...event,
        verdict: {
          decision: 'rejected',
          note: 'A verificação automática falhou; evento não publicado.',
          outage: true,
        },
      };
    }
  });
}
