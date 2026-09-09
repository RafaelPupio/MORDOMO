import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { organizations } from '@/db/schema';

export const DEMO_ORGANIZATION_SLUG = 'demo';

export type Organization = typeof organizations.$inferSelect;

type ClerkOrganization = {
  id: string;
  name: string;
  slug?: string | null;
  createdBy?: string | null;
};

export async function getOrganizationBySlug(db: Db, slug: string) {
  const [row] = await db.select().from(organizations).where(eq(organizations.slug, slug));
  return row;
}

export async function getOrganizationByClerkId(
  db: Db,
  clerkOrganizationId: string,
): Promise<Organization | undefined> {
  const [row] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.clerkOrganizationId, clerkOrganizationId));
  return row;
}

export async function upsertOrganizationFromClerk(
  db: Db,
  clerkOrganization: ClerkOrganization,
): Promise<Organization> {
  const values = {
    clerkOrganizationId: clerkOrganization.id,
    name: clerkOrganization.name,
    slug: clerkOrganization.slug ?? `org-${clerkOrganization.id}`,
    ownerClerkUserId: clerkOrganization.createdBy ?? null,
  };
  const [organization] = await db
    .insert(organizations)
    .values(values)
    .onConflictDoUpdate({
      target: organizations.clerkOrganizationId,
      set: values,
    })
    .returning();

  if (!organization) throw new Error('Organization was not saved.');
  return organization;
}
