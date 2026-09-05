import { generateObject, NoObjectGeneratedError } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { CHURCH_TIMEZONE_NOTE, UNTRUSTED_DOCUMENT_NOTE } from '@/agent/time-convention';
import { FAST_MODEL, priceableModelId } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import type { Db } from '@/db/client';

/**
 * How many events the extractor is asked to return, at most. This is the same number as
 * `MAX_CANDIDATES` in src/core/ingest.ts — that constant is defined FROM this one — because
 * a candidate the verifier will never see is pure cost.
 *
 * It also keeps the extractor's output inside `maxOutputTokens`. A 235-page bulletin with
 * a dated line every few lines made the model emit events until the 4096-token cap cut the
 * JSON mid-string ("Unterminated string in JSON at position 11544"), so `generateObject`
 * threw, `extractEvents` reported `failed`, and the document published with zero events
 * instead of its first eight (2026-09-05, first production load test). A bounded list is
 * far more useful than an unbounded one that cannot finish.
 */
export const MAX_EXTRACTED_EVENTS = 8;

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

// Liberal at the schema boundary, strict in our own code: `generateObject` validates the
// WHOLE `{ events: [...] }` payload in one shot, so a `.min/.max` bound here means one
// candidate with an out-of-range confidence throws NoObjectGeneratedError for the entire
// batch, discarding every legitimate event alongside it. `confidence` is left as a plain
// number and clamped to 0..1 per candidate below, once we have each row in hand.
const eventSchema = z.object({
  title: z.string().describe('Nome do evento, como aparece no documento'),
  startsAt: z.string().describe('Data e hora de início em ISO 8601 (UTC)'),
  location: z.string().nullable().describe('Local, se mencionado'),
  description: z.string().nullable().describe('Detalhe curto, se houver'),
  confidence: z.number().describe('Confiança de que este é um evento real com data (0 a 1)'),
  sourceQuote: z.string().describe('Trecho EXATO do documento que sustenta este evento'),
});

const extractionSchema = z.object({ events: z.array(eventSchema) });

// `extractEvents` must let its caller tell "this document genuinely has no events" apart
// from "the extractor could not run" — a zero-length `candidates` array means the FIRST
// one whenever `failed` is false, and means nothing trustworthy whenever `failed` is
// true. Collapsing both into a bare `ExtractedEvent[]` (the pre-fix shape) made a
// `generateObject` outage indistinguishable from a clean empty result, which is exactly
// what let `runIngest` treat an outage as "nothing to publish" and delete the document's
// previously verified events on the strength of that non-signal. See the caller in
// src/core/ingest.ts for how `failed` is used to skip that delete.
export type ExtractResult = { candidates: ExtractedEvent[]; failed: boolean };

function systemPrompt(referenceDate: string): string {
  return [
    'You extract calendar events from Brazilian church documents written in Portuguese.',
    `Today's reference date for resolving relative dates is ${referenceDate}.`,
    CHURCH_TIMEZONE_NOTE,
    UNTRUSTED_DOCUMENT_NOTE,
    'Extract ONLY events that have a date. Recurring weekly services stated as a general schedule are NOT events — skip them.',
    'sourceQuote must be copied verbatim from the document. Never paraphrase it, and never invent one: it is how a second reviewer checks your work.',
    'Prefer recall over precision — a low confidence value is better than omitting a plausible event, because everything you return is independently verified before it is published.',
    `Return at most ${MAX_EXTRACTED_EVENTS} events. When the document has more, keep the ${MAX_EXTRACTED_EVENTS} that start soonest on or after the reference date and omit the rest: a short, complete list is far more useful than a long one that never finishes.`,
    'Return an empty list when the document contains no dated events.',
  ].join('\n');
}

export async function extractEvents(
  deps: ExtractorDeps,
  input: ExtractorInput,
): Promise<ExtractResult> {
  const model = deps.model ?? FAST_MODEL;
  const pricedModel = priceableModelId(model, FAST_MODEL);

  let object: z.infer<typeof extractionSchema>;
  let usage: { inputTokens?: number; outputTokens?: number };
  try {
    ({ object, usage } = await generateObject({
      model,
      schema: extractionSchema,
      system: systemPrompt(input.referenceDate),
      prompt: input.text,
      // Bounds worst-case output size — see MAX_CANDIDATES in src/core/ingest.ts for the
      // full cost accounting this is one half of. 4096 output tokens is generous for any
      // real bulletin (a dozen-plus fully-populated candidate events) while ruling out an
      // unbounded response driving the verifier fan-out this same review flagged (I3).
      maxOutputTokens: 4096,
    }));
  } catch (error) {
    // A total failure here (network error, output the SDK could not repair into schema
    // shape) must not take down the whole document: the surrounding ingest pipeline can
    // still publish its chunks even with zero extracted events.
    console.error('ingest.extract: generateObject failed, returning no candidates for this document', {
      churchId: input.churchId, documentId: input.documentId, error,
    });
    // NoObjectGeneratedError sometimes still carries `usage` for the failed attempt (the
    // call was made and billed even though the output was unusable) — record it when
    // present, so the spend is not silently lost; when it isn't present, log loudly that
    // this call went unmetered instead of letting the gap pass silently.
    const failureUsage = NoObjectGeneratedError.isInstance(error) ? error.usage : undefined;
    if (failureUsage && ((failureUsage.inputTokens ?? 0) > 0 || (failureUsage.outputTokens ?? 0) > 0)) {
      try {
        await recordUsage(deps.db, {
          churchId: input.churchId,
          feature: 'ingest.extract',
          model: pricedModel,
          inputTokens: failureUsage.inputTokens ?? 0,
          outputTokens: failureUsage.outputTokens ?? 0,
        });
      } catch (usageError) {
        console.error('ingest.extract usage not recorded after generateObject failure', {
          churchId: input.churchId, documentId: input.documentId, error: usageError,
        });
      }
    } else {
      console.error('ingest.extract call went unmetered: generateObject failed with no usage to record', {
        churchId: input.churchId, documentId: input.documentId,
      });
    }
    return { candidates: [], failed: true };
  }

  try {
    await recordUsage(deps.db, {
      churchId: input.churchId,
      feature: 'ingest.extract',
      model: pricedModel,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
  } catch (error) {
    console.error('ingest.extract usage not recorded', {
      churchId: input.churchId, documentId: input.documentId, error,
    });
  }

  // Two cheap, deterministic guards before any model-generated row goes further: the
  // quote must actually occur in the source, and the date must be a full, real
  // date-and-time. These catch the most common hallucination shapes — a quote that was
  // never in the document, a date string that doesn't resolve to a real instant — without
  // spending a second model call on them. Neither guard checks that the EVENT itself is
  // real: a candidate can quote a genuine, unrelated sentence from the document and still
  // be invented. That is the verifier's job, not this one's.
  const candidates = object.events
    .map((event) => ({ ...event, confidence: clamp01(event.confidence) }))
    .filter((event) => {
      if (!isFullIsoDateTime(event.startsAt)) return false;
      return quoteAppearsIn(input.text, event.sourceQuote);
    });
  return { candidates, failed: false };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// `Date.parse` alone accepts partial values like "2026" (Jan 1, midnight UTC) and
// "Jan 2026" (also Jan 1, midnight UTC) as valid dates — exactly the kind of
// underspecified guess a model produces when a document names a month or a year without
// a specific day and time. The extractor's own system prompt asks for a full
// "Data e hora de início em ISO 8601 (UTC)", so a value that isn't a complete
// date-and-time is already off-contract; requiring the full shape here drops it before
// it costs a verifier call it was never going to survive on the merits anyway.
const FULL_ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function isFullIsoDateTime(value: string): boolean {
  return FULL_ISO_DATETIME.test(value) && Number.isFinite(Date.parse(value));
}

// Unicode-normalize both sides before comparing so benign typography drift — the most
// common way a model "copies" text — doesn't sink a legitimate quote: an em dash typed
// as a hyphen, curly quotes straightened, an accent dropped. This is still a full
// substring check, not a fuzzy one: we tolerate typography drift, not invented content,
// so a quote that is genuinely absent (or empty/whitespace-only) is still rejected.
function normalizeForQuoteMatch(s: string): string {
  return s
    .normalize('NFC')
    // hyphen/dash variants (hyphen, non-breaking hyphen, figure/en/em dash, horizontal
    // bar) and the minus sign, all commonly substituted for a plain '-'
    .replace(/[‐-―−]/g, '-')
    // curly/other single-quote-shaped marks -> straight apostrophe
    .replace(/[‘’ʼ´`]/g, "'")
    // curly double quotes -> straight double quote
    .replace(/[“”]/g, '"')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // fold diacritics: "sábado" -> "sabado"
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function quoteAppearsIn(text: string, quote: string): boolean {
  if (quote.trim().length === 0) return false;
  return normalizeForQuoteMatch(text).includes(normalizeForQuoteMatch(quote));
}
