import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { organizations } from '@/db/schema';

export const DEMO_ORGANIZATION_SLUG = 'demo';

export async function getOrganizationBySlug(db: Db, slug: string) {
  const [row] = await db.select().from(organizations).where(eq(organizations.slug, slug));
  return row;
}
