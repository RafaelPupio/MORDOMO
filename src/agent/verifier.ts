import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { ExtractedEvent } from '@/agent/extractor';
import { FAST_MODEL } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import type { Db } from '@/db/client';

export type VerifierDeps = { db: Db; model?: LanguageModel };
export type VerifierInput = {
  churchId: string;
  documentId: string;
  text: string;
  events: ExtractedEvent[];
};

export type Verdict = { decision: 'confirmed' | 'rejected'; note: string };
export type VerifiedEvent = ExtractedEvent & { verdict: Verdict };

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

  return Promise.all(
    input.events.map(async (event): Promise<VerifiedEvent> => {
      try {
        const { object, usage } = await generateObject({
          model: deps.model ?? FAST_MODEL,
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
            model: FAST_MODEL,
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
        // must not become a silent path for unchecked data into the calendar.
        console.error('ingest.verify failed; rejecting candidate', {
          churchId: input.churchId, documentId: input.documentId, title: event.title, error,
        });
        return {
          ...event,
          verdict: { decision: 'rejected', note: 'A verificação automática falhou; evento não publicado.' },
        };
      }
    }),
  );
}
