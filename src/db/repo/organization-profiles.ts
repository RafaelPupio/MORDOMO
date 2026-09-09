import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { parseOrganizationProfile, type OrganizationProfile } from '@/core/organization-profile';
import { organizationProfiles } from '@/db/schema';

export async function getOrganizationProfile(db: Db, organizationId: string) {
  const [profile] = await db
    .select()
    .from(organizationProfiles)
    .where(eq(organizationProfiles.organizationId, organizationId));
  return profile;
}

export async function upsertOrganizationProfile(
  db: Db,
  organizationId: string,
  input: OrganizationProfile,
) {
  const profile = parseOrganizationProfile(input);
  const [saved] = await db
    .insert(organizationProfiles)
    .values({ organizationId, ...profile })
    .onConflictDoUpdate({
      target: organizationProfiles.organizationId,
      set: { ...profile, updatedAt: new Date() },
    })
    .returning();
  return saved;
}
