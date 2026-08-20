import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { churches } from '@/db/schema';

export const DEMO_CHURCH_SLUG = 'demo';

export async function getChurchBySlug(db: Db, slug: string) {
  const [row] = await db.select().from(churches).where(eq(churches.slug, slug));
  return row;
}
