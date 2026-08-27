import { and, eq } from 'drizzle-orm';
import type { LanguageModel } from 'ai';
import { extractEvents, type ExtractedEvent } from '@/agent/extractor';
import { verifyEvents, type Verdict, type VerifiedEvent } from '@/agent/verifier';
import type { Embedder } from '@/ai/embedder';
import { recordUsage } from '@/ai/usage';
import { chunkMarkdown } from '@/core/chunking';
import type { IngestStatus } from '@/core/ingest-status';
import { parseDocument } from '@/core/parse-document';
import type { Db } from '@/db/client';
import {
  beginIngestRun, forceIngestFailed, getDocument, setIngestStatus,
} from '@/db/repo/documents';
import { chunks, events } from '@/db/schema';

export type IngestDeps = {
  db: Db;
  embedder: Embedder;
  /** Omit to skip the agent stages entirely (used by tests and by text-only re-indexing). */
  extractorModel?: LanguageModel;
  verifierModel?: LanguageModel;
};

export type IngestInput = {
  organizationId: string;
  documentId: string;
  bytes: Uint8Array;
  mimeType: string;
  /** Defaults to today; the extractor uses it to resolve relative dates. */
  referenceDate?: string;
};

export type IngestResult = {
  documentId: string;
  status: IngestStatus;
  chunkCount: number;
  extracted: number;
  published: number;
  rejected: number;
  /** True when the source text was longer than MAX_EXTRACTION_CHARS and the extractor /
   *  verifier only saw the first MAX_EXTRACTION_CHARS of it (chunking/embedding still
   *  covered the whole document — see the comment on MAX_EXTRACTION_CHARS). */
  truncatedForExtraction: boolean;
  /** True when the extractor's `generateObject` call failed outright (network error,
   *  unrepairable output) rather than cleanly finding zero events. When this is true,
   *  `extracted`/`published`/`rejected` are all 0 for lack of anything to report, but
   *  that 0 does NOT mean "this document has no events" — see `eventsReplaced`. */
  extractionFailed: boolean;
  /** True when this run's events delete+insert actually ran, replacing the document's
   *  previous events with this run's outcome (even if that outcome is zero confirmed
   *  events — a clean, real "no events" result is still a replace). False means the
   *  previous events were left untouched because this run could not produce a
   *  trustworthy verdict at all: either extraction failed outright, or every candidate
   *  was rejected because verification itself was unavailable (an outage, or no
   *  `verifierModel` configured) rather than because the document didn't support them. */
  eventsReplaced: boolean;
};

// `extractEvents` and `verifyEvents` (src/agent/extractor.ts, src/agent/verifier.ts) pass
// whatever text they're given straight into the model prompt with no truncation of their
// own — bounding it is this orchestration layer's job, not theirs, because only here do we
// know the FULL parsed text before deciding how much of it the agent stages actually need.
//
// Per-request cost without this bound is effectively unlimited relative to the monthly
// budget cap: MAX_UPLOAD_BYTES (src/channels/ingest-http.ts) allows a 5 MiB upload, which
// for typical prose is roughly 5,000,000 / 4 ≈ 1,250,000 tokens (a rough ~4 chars/token
// estimate). At FAST_MODEL's $1/M input price (src/ai/pricing.ts) that's about $1.25 in
// ONE extractor call, plus a comparable amount again per candidate event in the verifier —
// and the endpoint permits 10 such requests/hour (INGEST_LIMIT). checkBudget() only checks
// the cap BEFORE a request runs, so nothing stops one oversized upload from blowing well
// past a tenant's entire monthly budget before the spend it caused is ever recorded.
//
// 40,000 characters (~10,000 tokens) bounds the EXTRACTOR call to roughly $0.01
// (10,000 tokens * FAST_MODEL's $1/M input price) — but the verifier resends this same
// text with EVERY candidate's prompt (src/agent/verifier.ts), so the verifier's total
// cost is per-candidate, not fixed. Left unbounded, that fan-out is the whole cost: a
// review of this pipeline measured 120 candidates from one adversarial document costing
// $1.2180 — each verifier call individually cheap, the COUNT unbounded. MAX_CANDIDATES
// below caps that multiplier; see its comment for the resulting worst-case total. Chunking
// and embedding (EMBEDDING_MODEL is ~50x cheaper per token than FAST_MODEL, per
// src/ai/pricing.ts) still run over the FULL, untruncated text, so retrieval quality — what
// a visitor's question can actually surface — is unaffected; only the agent stages that
// decide what reaches the calendar are bounded.
export const MAX_EXTRACTION_CHARS = 40_000;

// Caps how many extractor candidates ever reach the verifier. Without this, the
// extractor's own output size is the only limit on fan-out (see `maxOutputTokens` in
// src/agent/extractor.ts for that half of the bound) — and each verifier call resends the
// FULL extraction text (up to MAX_EXTRACTION_CHARS) alongside one candidate, so cost scales
// with candidate COUNT, not just text size.
//
// Worst-case arithmetic at FAST_MODEL pricing ($1/M input, $5/M output —
// src/ai/pricing.ts), assuming every call maxes its input at MAX_EXTRACTION_CHARS
// (~10,000 tokens) and a generous ~200-token verdict output:
//   extractor:  1 call  * (10,000 * $1/M + 4,096 * $5/M)      ≈ $0.0305
//   verifier:   8 calls * (10,000 * $1/M + 200   * $5/M)      ≈ $0.088
//   total per ingest run                                      ≈ $0.12
// That is the ceiling for ANY single document, however many events a hostile or malformed
// upload's extractor output claims — down from the unbounded $1.2180 measured against 120
// candidates before this cap existed. 8 is deliberately generous for a real church
// bulletin (which realistically names a handful of dated events, not dozens) while keeping
// the worst case a known, checkable number rather than a provider default.
export const MAX_CANDIDATES = 8;

// A crashed run's recovery write must itself never fail. `error.message` can carry
// arbitrary bytes from wherever the run actually broke — including, in the exact scenario
// this exists to guard against, a raw NUL byte or a lone UTF-16 surrogate that made its way
// into a Postgres error message after a chunk/event insert rejected unstorable text (see
// F2 in the ingest security review; src/channels/ingest-http.ts now rejects that text
// before a document row even exists, but this stays as defense in depth for any other path
// that can reach this catch, e.g. `runIngest` called directly rather than through the HTTP
// channel). Writing that message straight into `documents.ingest_error` — itself a
// Postgres text column — would fail for the SAME reason the original write failed,
// and `forceIngestFailed`'s whole reason for existing is to be a recovery write that
// cannot itself throw. `toWellFormed()` (ES2024) replaces any lone surrogate with U+FFFD.
function sanitizeForStorage(message: string): string {
  const NUL = String.fromCharCode(0);
  return message.split(NUL).join('').toWellFormed();
}

/**
 * Runs one document through the pipeline. Deterministic stages (parse → chunk → embed)
 * come first so the knowledge base is correct even when the agent stages find nothing;
 * the extractor/verifier pair then decides what, if anything, reaches the calendar.
 * Every stage moves the document through `ingest_status`, so a crashed run is always
 * visibly parked in a known state.
 *
 * Starting the run goes through `beginIngestRun` rather than a plain `setIngestStatus`
 * call: `published` is terminal in the state machine (a document that already serves
 * answers is never automatically pulled back into the pipeline), but a caller explicitly
 * asking to re-ingest a published document is a distinct, intentional action, not the
 * machine loosening itself — see the doc comment on `beginIngestRun` for the full
 * reasoning. Every other starting status (`uploaded`, `failed`) is still fully
 * machine-checked.
 */
export async function runIngest(deps: IngestDeps, input: IngestInput): Promise<IngestResult> {
  const { db, embedder } = deps;
  const { organizationId, documentId } = input;

  const doc = await getDocument(db, organizationId, documentId);
  if (!doc) throw new Error(`Document ${documentId} not found for church ${organizationId}`);

  const result: IngestResult = {
    documentId, status: doc.ingestStatus as IngestStatus,
    chunkCount: 0, extracted: 0, published: 0, rejected: 0, truncatedForExtraction: false,
    extractionFailed: false, eventsReplaced: false,
  };

  try {
    await beginIngestRun(db, organizationId, documentId);
    result.status = 'parsing';

    const parsed = await parseDocument(input.bytes, input.mimeType);

    // Compute and embed the new chunks BEFORE touching the old ones. Re-ingest is a
    // replace, not an append, but the replace must not destroy the previous content
    // until its successor is actually ready: if embedding throws here (a transient
    // embedding-API outage is the common case), the document's existing, previously
    // published chunks are still untouched and still retrievable.
    const pieces = chunkMarkdown(parsed.text);
    let embeddings: number[][] = [];
    let embedTokens = 0;
    if (pieces.length > 0) {
      const embedded = await embedder.embed(pieces.map((p) => p.content));
      embeddings = embedded.embeddings;
      embedTokens = embedded.tokens;
    }

    // Delete-then-insert, with nothing awaitable in between: the production driver
    // (neon-http; see src/db/client.ts) does not support `db.transaction` — it throws
    // "No transactions support in neon-http driver" — so this ordering, not a
    // transaction, is what keeps a failure from ever landing between the two writes.
    // (PGlite, the test driver, does support `db.transaction`, but wrapping only the
    // test path would protect nothing in production, so it is not used here.)
    await db.delete(chunks).where(and(eq(chunks.organizationId, organizationId), eq(chunks.documentId, documentId)));
    if (pieces.length > 0) {
      await db.insert(chunks).values(
        pieces.map((piece, i) => ({
          organizationId, documentId, seq: piece.seq, content: piece.content, embedding: embeddings[i],
        })),
      );
    }
    result.chunkCount = pieces.length;
    if (embedTokens > 0) {
      try {
        await recordUsage(db, {
          organizationId, feature: 'ingest.embed', model: embedder.model,
          inputTokens: embedTokens, outputTokens: 0,
        });
      } catch (error) {
        console.error('ingest.embed usage not recorded', { organizationId, documentId, error });
      }
    }

    await setIngestStatus(db, organizationId, documentId, 'extracting');
    result.status = 'extracting';

    // Bound what the agent stages see — see the comment on MAX_EXTRACTION_CHARS above for
    // the cost math. Chunking/embedding above already ran over the full `parsed.text`; only
    // the extractor/verifier prompts are capped here.
    result.truncatedForExtraction = parsed.text.length > MAX_EXTRACTION_CHARS;
    if (result.truncatedForExtraction) {
      // Expected behavior on a long document, not a failure — MAX_EXTRACTION_CHARS is a
      // deliberate cost bound (see its comment above), and chunking/embedding still
      // covered the whole text. console.warn, not console.error, so this doesn't read as
      // an incident in the logs.
      console.warn('ingest: text truncated before extraction/verification', {
        organizationId, documentId, fullLength: parsed.text.length, truncatedTo: MAX_EXTRACTION_CHARS,
      });
    }
    const extractionText = result.truncatedForExtraction
      ? parsed.text.slice(0, MAX_EXTRACTION_CHARS)
      : parsed.text;

    const referenceDate = input.referenceDate ?? new Date().toISOString().slice(0, 10);
    let candidates: ExtractedEvent[] = [];
    if (deps.extractorModel) {
      const extraction = await extractEvents(
        { db, model: deps.extractorModel },
        { organizationId, documentId, text: extractionText, referenceDate },
      );
      candidates = extraction.candidates;
      // A failed extraction is NOT the same as a clean "no events" result — see the doc
      // comment on `IngestResult.extractionFailed`. This flag is what lets the
      // delete+insert below be skipped instead of wiping the document's previously
      // verified events on the strength of a call that never actually ran.
      result.extractionFailed = extraction.failed;
    }
    result.extracted = candidates.length;

    // Cap fan-out into the verifier before it ever gets there — see MAX_CANDIDATES's
    // comment for the cost math this bounds.
    const boundedCandidates = candidates.length > MAX_CANDIDATES
      ? candidates.slice(0, MAX_CANDIDATES)
      : candidates;
    if (candidates.length > MAX_CANDIDATES) {
      console.warn('ingest: extracted candidates exceeded MAX_CANDIDATES, dropping the excess before verification', {
        organizationId, documentId, extracted: candidates.length, kept: MAX_CANDIDATES,
      });
    }

    await setIngestStatus(db, organizationId, documentId, 'verifying');
    result.status = 'verifying';

    let verified: VerifiedEvent[] = [];
    if (boundedCandidates.length > 0) {
      if (deps.verifierModel) {
        verified = await verifyEvents(
          { db, model: deps.verifierModel },
          { organizationId, documentId, text: extractionText, events: boundedCandidates },
        );
      } else {
        // Mirror the extractor's own gate (`deps.extractorModel` above): omitting
        // `verifierModel` must not fall through to `verifyEvents`'s `deps.model ??
        // FAST_MODEL` default, which resolves a bare model-id STRING against the real,
        // billed AI Gateway. There is nothing to verify with, so every candidate is
        // rejected with the same `outage: true` marker `verifyEvents` itself uses for a
        // failed call — verification being unconfigured is exactly as untrustworthy as
        // verification being unreachable, and gets the same fail-closed treatment.
        console.error('ingest.verify: no verifierModel configured; rejecting all candidates instead of making a live call', {
          organizationId, documentId, candidateCount: boundedCandidates.length,
        });
        const outageVerdict: Verdict = {
          decision: 'rejected', note: 'Verificador não configurado; evento não publicado.', outage: true,
        };
        verified = boundedCandidates.map((e) => ({ ...e, verdict: outageVerdict }));
      }
    }

    const confirmed = verified.filter((e) => e.verdict.decision === 'confirmed');
    result.published = confirmed.length;
    result.rejected = verified.length - confirmed.length;

    // The previous events survive extraction and verification UNLESS this run actually
    // produced a trustworthy verdict — either a genuine confirm/reject (the document was
    // read and judged) or a genuine "no candidates" (nothing to judge). What must NOT
    // replace them: extraction failing outright (`result.extractionFailed`), or every
    // candidate coming back rejected only because verification itself was unavailable
    // (`outage: true` on all of them) rather than because the document didn't support
    // them. Both of those are "we don't know", not "the answer is no" — publishing an
    // empty replace on the strength of "we don't know" is exactly the fail-DESTRUCTIVE
    // bug this guards against: an agent-stage outage must reject candidates it couldn't
    // check (see verifyEvents), but it must never delete events a PREVIOUS, successful
    // run already verified.
    const allVerifiedWereOutage = verified.length > 0 && verified.every((e) => e.verdict.outage === true);
    const skipEventsReplace = result.extractionFailed || allVerifiedWereOutage;
    result.eventsReplaced = !skipEventsReplace;

    if (skipEventsReplace) {
      console.warn('ingest: leaving existing events untouched — extraction failed or verification was entirely unavailable this run', {
        organizationId, documentId, extractionFailed: result.extractionFailed, allVerifiedWereOutage,
      });
    } else {
      // Delete-then-insert, with nothing awaitable in between: the production driver
      // (neon-http; see src/db/client.ts) does not support `db.transaction` — it throws
      // "No transactions support in neon-http driver" — so this ordering, not a
      // transaction, is what keeps a failure from ever landing between the two writes.
      await db.delete(events).where(and(eq(events.organizationId, organizationId), eq(events.sourceDocumentId, documentId)));
      if (confirmed.length > 0) {
        await db.insert(events).values(
          confirmed.map((e) => ({
            organizationId,
            title: e.title,
            startsAt: new Date(e.startsAt),
            location: e.location,
            description: e.description,
            verified: true,
            sourceDocumentId: documentId,
            extractionConfidence: e.confidence,
            verificationNote: e.verdict.note,
            sourceQuote: e.sourceQuote,
          })),
        );
      }
    }

    await setIngestStatus(db, organizationId, documentId, 'published');
    result.status = 'published';
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('ingest failed', { organizationId, documentId, error });
    try {
      const current = await getDocument(db, organizationId, documentId);
      if (current && current.ingestStatus !== 'published') {
        // `setIngestStatus` cannot be used for this recovery write: it re-checks
        // `assertTransition` against whatever status the row currently holds, and if
        // that status is itself corrupted/unknown, this catch's own recovery write
        // would throw `UnknownIngestStatusError` again — leaving the document stuck
        // forever with no diagnostic. `forceIngestFailed` bypasses the state machine
        // on purpose, for exactly this one caller. `message` is sanitized first (see
        // `sanitizeForStorage` above) so THIS write cannot fail for the same reason the
        // original one did.
        await forceIngestFailed(db, organizationId, documentId, sanitizeForStorage(message));
        result.status = 'failed';
      }
    } catch (statusError) {
      // The DB does not actually hold 'failed' — do not claim it does. `result.status`
      // keeps whatever value it was last set to (the most recent stage transition that
      // really did persist, or the document's original status if we never got that
      // far), which is the true, currently-persisted state.
      console.error('could not mark document failed', { organizationId, documentId, statusError });
    }
    return result;
  }
}
