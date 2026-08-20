import { and, eq } from 'drizzle-orm';
import type { LanguageModel } from 'ai';
import { extractEvents } from '@/agent/extractor';
import { verifyEvents } from '@/agent/verifier';
import type { Embedder } from '@/ai/embedder';
import { recordUsage } from '@/ai/usage';
import { chunkMarkdown } from '@/core/chunking';
import type { IngestStatus } from '@/core/ingest-status';
import { parseDocument } from '@/core/parse-document';
import type { Db } from '@/db/client';
import { beginIngestRun, getDocument, saveSourceText, setIngestStatus } from '@/db/repo/documents';
import { chunks, events } from '@/db/schema';

export type IngestDeps = {
  db: Db;
  embedder: Embedder;
  /** Omit to skip the agent stages entirely (used by tests and by text-only re-indexing). */
  extractorModel?: LanguageModel;
  verifierModel?: LanguageModel;
};

export type IngestInput = {
  churchId: string;
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
};

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
  const { churchId, documentId } = input;

  const doc = await getDocument(db, churchId, documentId);
  if (!doc) throw new Error(`Document ${documentId} not found for church ${churchId}`);

  const result: IngestResult = {
    documentId, status: doc.ingestStatus as IngestStatus,
    chunkCount: 0, extracted: 0, published: 0, rejected: 0,
  };

  try {
    await beginIngestRun(db, churchId, documentId);
    result.status = 'parsing';

    const parsed = await parseDocument(input.bytes, input.mimeType);
    await saveSourceText(db, churchId, documentId, parsed.text);

    // Re-ingest is a replace, not an append: drop this document's previous chunks and
    // its previously extracted events before writing new ones.
    await db.delete(chunks).where(and(eq(chunks.churchId, churchId), eq(chunks.documentId, documentId)));
    await db.delete(events).where(and(eq(events.churchId, churchId), eq(events.sourceDocumentId, documentId)));

    const pieces = chunkMarkdown(parsed.text);
    if (pieces.length > 0) {
      const { embeddings, tokens } = await embedder.embed(pieces.map((p) => p.content));
      await db.insert(chunks).values(
        pieces.map((piece, i) => ({
          churchId, documentId, seq: piece.seq, content: piece.content, embedding: embeddings[i],
        })),
      );
      result.chunkCount = pieces.length;
      if (tokens > 0) {
        try {
          await recordUsage(db, {
            churchId, feature: 'ingest.embed', model: embedder.model,
            inputTokens: tokens, outputTokens: 0,
          });
        } catch (error) {
          console.error('ingest.embed usage not recorded', { churchId, documentId, error });
        }
      }
    }

    await setIngestStatus(db, churchId, documentId, 'extracting');
    result.status = 'extracting';

    const referenceDate = input.referenceDate ?? new Date().toISOString().slice(0, 10);
    const candidates = deps.extractorModel
      ? await extractEvents(
          { db, model: deps.extractorModel },
          { churchId, documentId, text: parsed.text, referenceDate },
        )
      : [];
    result.extracted = candidates.length;

    await setIngestStatus(db, churchId, documentId, 'verifying');
    result.status = 'verifying';

    const verified = candidates.length
      ? await verifyEvents(
          { db, model: deps.verifierModel },
          { churchId, documentId, text: parsed.text, events: candidates },
        )
      : [];

    const confirmed = verified.filter((e) => e.verdict.decision === 'confirmed');
    result.published = confirmed.length;
    result.rejected = verified.length - confirmed.length;

    if (confirmed.length > 0) {
      await db.insert(events).values(
        confirmed.map((e) => ({
          churchId,
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

    await setIngestStatus(db, churchId, documentId, 'published');
    result.status = 'published';
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('ingest failed', { churchId, documentId, error });
    try {
      const current = await getDocument(db, churchId, documentId);
      if (current && current.ingestStatus !== 'published') {
        await setIngestStatus(db, churchId, documentId, 'failed', { error: message });
      }
    } catch (statusError) {
      console.error('could not mark document failed', { churchId, documentId, statusError });
    }
    result.status = 'failed';
    return result;
  }
}
