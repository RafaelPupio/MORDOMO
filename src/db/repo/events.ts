import { and, asc, eq, gte } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { events } from '@/db/schema';

export async function listUpcomingEvents(db: Db, churchId: string, limit = 10, now = new Date()) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.churchId, churchId), gte(events.startsAt, now)))
    .orderBy(asc(events.startsAt))
    .limit(limit);
}

export async function createEvent(
  db: Db,
  input: { churchId: string; title: string; startsAt: Date; location?: string; description?: string },
) {
  const [row] = await db.insert(events).values(input).returning();
  return row;
}
