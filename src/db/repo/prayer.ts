import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { prayerRequests } from '@/db/schema';

export type PrayerStatus = 'new' | 'praying' | 'done';

export async function createPrayerRequest(
  db: Db,
  input: { churchId: string; conversationId?: string; name?: string; request: string },
) {
  const [row] = await db.insert(prayerRequests).values(input).returning();
  return row;
}

export async function listPrayerRequests(db: Db, churchId: string, status?: PrayerStatus) {
  const conds = [eq(prayerRequests.churchId, churchId)];
  if (status) conds.push(eq(prayerRequests.status, status));
  return db
    .select()
    .from(prayerRequests)
    .where(and(...conds))
    .orderBy(desc(prayerRequests.createdAt));
}

export async function setPrayerStatus(
  db: Db,
  churchId: string,
  id: string,
  status: PrayerStatus,
): Promise<void> {
  await db
    .update(prayerRequests)
    .set({ status })
    .where(and(eq(prayerRequests.churchId, churchId), eq(prayerRequests.id, id)));
}
