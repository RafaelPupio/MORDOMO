// The ingest pipeline is a small explicit state machine so a half-finished or crashed
// run is always visibly in one known state, and so a retry can only resume from a legal
// point. `published` is terminal: a document that already serves answers is never
// silently pulled back into the pipeline — re-ingesting creates a new run from `parsing`.
export const INGEST_STATUSES = [
  'uploaded', 'parsing', 'extracting', 'verifying', 'published', 'failed',
] as const;

export type IngestStatus = (typeof INGEST_STATUSES)[number];

const ALLOWED: Record<IngestStatus, readonly IngestStatus[]> = {
  uploaded: ['parsing', 'failed'],
  parsing: ['extracting', 'failed'],
  extracting: ['verifying', 'failed'],
  verifying: ['published', 'failed'],
  published: [],
  failed: ['parsing'],
};

/**
 * Thrown when `canTransition`/`assertTransition` are asked about a status that isn't one
 * of `INGEST_STATUSES`. `documents.ingest_status` is an untyped text column, so a value
 * read back from the database — corrupted by hand, written by an older/newer app version,
 * or otherwise stale — is not guaranteed to be a real `IngestStatus` even though callers
 * cast it as one. Without this check, indexing `ALLOWED` with such a value would return
 * `undefined` and the subsequent `.includes(to)` would throw a raw, unnamed `TypeError`.
 * This turns that into a clear, named failure instead — callers should treat it the same
 * way as an illegal transition (the document is effectively stuck and needs attention),
 * not silently coerce it into some assumed state.
 */
export class UnknownIngestStatusError extends Error {
  constructor(public readonly status: string) {
    super(`Unknown ingest status: ${JSON.stringify(status)}`);
    this.name = 'UnknownIngestStatusError';
  }
}

function assertKnownStatus(status: IngestStatus): void {
  if (!(INGEST_STATUSES as readonly string[]).includes(status)) {
    throw new UnknownIngestStatusError(status);
  }
}

export function canTransition(from: IngestStatus, to: IngestStatus): boolean {
  assertKnownStatus(from);
  assertKnownStatus(to);
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: IngestStatus, to: IngestStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal ingest transition: ${from} -> ${to}`);
  }
}
