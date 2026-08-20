import { and, desc, eq } from 'drizzle-orm';
import { assertTransition, type IngestStatus } from '@/core/ingest-status';
import type { Db } from '@/db/client';
import { documents } from '@/db/schema';

export async function createDocument(
  db: Db,
  input: { churchId: string; title: string; kind: string; sourcePath?: string },
) {
  const [row] = await db
    .insert(documents)
    .values({ ...input, ingestStatus: 'uploaded' })
    .returning();
  return row;
}

export async function getDocument(db: Db, churchId: string, documentId: string) {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.churchId, churchId), eq(documents.id, documentId)));
  return row;
}

export async function listDocuments(db: Db, churchId: string) {
  return db
    .select()
    .from(documents)
    .where(eq(documents.churchId, churchId))
    .orderBy(desc(documents.createdAt));
}

export async function saveSourceText(db: Db, churchId: string, documentId: string, text: string) {
  await db
    .update(documents)
    .set({ sourceText: text })
    .where(and(eq(documents.churchId, churchId), eq(documents.id, documentId)));
}

/**
 * Moves a document to `status`, refusing an illegal transition. Reads the current row
 * first so the state machine — not the caller — decides what is allowed.
 */
export async function setIngestStatus(
  db: Db,
  churchId: string,
  documentId: string,
  status: IngestStatus,
  opts: { error?: string | null } = {},
) {
  const current = await getDocument(db, churchId, documentId);
  if (!current) throw new Error(`Document ${documentId} not found for church ${churchId}`);
  assertTransition(current.ingestStatus as IngestStatus, status);
  await db
    .update(documents)
    .set({ ingestStatus: status, ingestError: opts.error ?? null })
    .where(and(eq(documents.churchId, churchId), eq(documents.id, documentId)));
}

/**
 * Starts a fresh ingest run, whatever state the document is currently in.
 *
 * `published` is intentionally TERMINAL in the state machine — `canTransition('published',
 * 'parsing')` is `false`, and that is tested and load-bearing: the machine must never let
 * an ordinary, automatic transition pull a document that already serves answers back into
 * the pipeline. Re-ingest is a different thing: it is an explicit, caller-initiated action
 * (a human, or `runIngest`, deliberately decided to reprocess this document), so it is
 * implemented as its own named operation here in the repo layer, rather than as a hole
 * opened up in the generic transition table that every other caller would also inherit.
 *
 * Only the `published` case bypasses `assertTransition`, and only to land on `parsing`.
 * Every other starting status (`uploaded`, `failed`) still goes through the ordinary,
 * machine-checked `setIngestStatus` — so a document caught mid-run (`parsing` /
 * `extracting` / `verifying`) still gets a loud "illegal transition" error instead of being
 * silently restarted out from under an in-flight run.
 */
export async function beginIngestRun(db: Db, churchId: string, documentId: string): Promise<void> {
  const current = await getDocument(db, churchId, documentId);
  if (!current) throw new Error(`Document ${documentId} not found for church ${churchId}`);

  if (current.ingestStatus === 'published') {
    await db
      .update(documents)
      .set({ ingestStatus: 'parsing', ingestError: null })
      .where(and(eq(documents.churchId, churchId), eq(documents.id, documentId)));
    return;
  }

  await setIngestStatus(db, churchId, documentId, 'parsing');
}
