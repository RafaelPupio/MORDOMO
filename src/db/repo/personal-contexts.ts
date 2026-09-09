import type { Db } from '@/db/client';
import { eq } from 'drizzle-orm';
import { personalContexts } from '@/db/schema';

export type PersonalContext = typeof personalContexts.$inferSelect;

export async function getOrCreatePersonalContext(
  db: Db,
  clerkUserId: string,
): Promise<PersonalContext> {
  const [created] = await db
    .insert(personalContexts)
    .values({ clerkUserId })
    .onConflictDoNothing({ target: personalContexts.clerkUserId })
    .returning();

  if (created) return created;

  const [existing] = await db
    .select()
    .from(personalContexts)
    .where(eq(personalContexts.clerkUserId, clerkUserId));

  if (!existing) throw new Error('Personal context was not created.');
  return existing;
}
