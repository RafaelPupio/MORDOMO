import { and, asc, eq, gte } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { events } from '@/db/schema';

// `events.verified` is the verifier agent's whole reason for existing (src/agent/verifier.ts):
// it is what a candidate becomes once a second, independent model call has checked it
// against the source document and could not disprove it. Without this filter, that verdict
// had no read-time enforcement at all — an unverified row (the schema default is `false`;
// see `createEvent` below) would sit in the table indistinguishable from a checked one and
// still reach this list, making the verifier's entire guarantee a single in-memory
// `.filter()` upstream that any other writer could bypass just by inserting a row.
export async function listUpcomingEvents(db: Db, churchId: string, limit = 10, now = new Date()) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.churchId, churchId), gte(events.startsAt, now), eq(events.verified, true)))
    .orderBy(asc(events.startsAt))
    .limit(limit);
}

export async function createEvent(
  db: Db,
  input: {
    churchId: string; title: string; startsAt: Date; location?: string; description?: string;
    /** Defaults to the schema's own default (`false`) when omitted — a caller inserting an
     *  event outside the verified ingest pipeline (seeding, a future manual-entry UI) must
     *  say so explicitly to have it show up in `listUpcomingEvents`. */
    verified?: boolean;
  },
) {
  const [row] = await db.insert(events).values(input).returning();
  return row;
}
