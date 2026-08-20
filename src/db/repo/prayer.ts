import { desc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { prayerRequests } from '@/db/schema';

export async function createPrayerRequest(
  db: Db,
  input: { churchId: string; conversationId?: string; name?: string; request: string },
) {
  const [row] = await db.insert(prayerRequests).values(input).returning();
  return row;
}

export async function listPrayerRequests(db: Db, churchId: string) {
  return db
    .select()
    .from(prayerRequests)
    .where(eq(prayerRequests.churchId, churchId))
    .orderBy(desc(prayerRequests.createdAt));
}
