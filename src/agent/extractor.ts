import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { FAST_MODEL } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import type { Db } from '@/db/client';

export type ExtractorDeps = { db: Db; model?: LanguageModel };
export type ExtractorInput = {
  churchId: string;
  documentId: string;
  text: string;
  /** ISO date the document is relative to, so "domingo que vem" can be resolved. */
  referenceDate: string;
};

export type ExtractedEvent = {
  title: string;
  startsAt: string;
  location: string | null;
  description: string | null;
  confidence: number;
  sourceQuote: string;
};

const eventSchema = z.object({
  title: z.string().describe('Nome do evento, como aparece no documento'),
  startsAt: z.string().describe('Data e hora de início em ISO 8601 (UTC)'),
  location: z.string().nullable().describe('Local, se mencionado'),
  description: z.string().nullable().describe('Detalhe curto, se houver'),
  confidence: z.number().min(0).max(1).describe('Confiança de que este é um evento real com data'),
  sourceQuote: z.string().describe('Trecho EXATO do documento que sustenta este evento'),
});

const extractionSchema = z.object({ events: z.array(eventSchema) });

function systemPrompt(referenceDate: string): string {
  return [
    'You extract calendar events from Brazilian church documents written in Portuguese.',
    `Today's reference date for resolving relative dates is ${referenceDate}. Assume times are America/Sao_Paulo (UTC-3) unless the document says otherwise, and output startsAt in UTC.`,
    'Extract ONLY events that have a date. Recurring weekly services stated as a general schedule are NOT events — skip them.',
    'sourceQuote must be copied verbatim from the document. Never paraphrase it, and never invent one: it is how a second reviewer checks your work.',
    'Prefer recall over precision — a low confidence value is better than omitting a plausible event, because everything you return is independently verified before it is published.',
    'Return an empty list when the document contains no dated events.',
  ].join('\n');
}

export async function extractEvents(
  deps: ExtractorDeps,
  input: ExtractorInput,
): Promise<ExtractedEvent[]> {
  const { object, usage } = await generateObject({
    model: deps.model ?? FAST_MODEL,
    schema: extractionSchema,
    system: systemPrompt(input.referenceDate),
    prompt: input.text,
  });

  try {
    await recordUsage(deps.db, {
      churchId: input.churchId,
      feature: 'ingest.extract',
      model: FAST_MODEL,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
  } catch (error) {
    console.error('ingest.extract usage not recorded', {
      churchId: input.churchId, documentId: input.documentId, error,
    });
  }

  // Two cheap, deterministic guards before any model-generated row goes further: the
  // quote must actually occur in the source, and the date must be real. These catch the
  // most common hallucination shapes without spending a second model call on them.
  return object.events.filter((event) => {
    if (!Number.isFinite(Date.parse(event.startsAt))) return false;
    return quoteAppearsIn(input.text, event.sourceQuote);
  });
}

function quoteAppearsIn(text: string, quote: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalize(text).includes(normalize(quote)) && quote.trim().length > 0;
}
