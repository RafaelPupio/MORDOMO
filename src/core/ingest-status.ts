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

export function canTransition(from: IngestStatus, to: IngestStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: IngestStatus, to: IngestStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal ingest transition: ${from} -> ${to}`);
  }
}
