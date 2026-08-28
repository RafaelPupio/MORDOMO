import { and, desc, eq } from 'drizzle-orm';
import type { SecretaryProfile } from '@/core/secretary-profile';
import { parseSecretaryProfile } from '@/core/secretary-profile';
import type { Db } from '@/db/client';
import { secretaryProfileVersions } from '@/db/schema';

export type SecretaryProfileVersion = Omit<
  typeof secretaryProfileVersions.$inferSelect,
  'profile'
> & { profile: SecretaryProfile };

function parseVersion(
  version: typeof secretaryProfileVersions.$inferSelect,
): SecretaryProfileVersion {
  return { ...version, profile: parseSecretaryProfile(version.profile) };
}

export async function getLatestOrganizationSecretaryProfile(
  db: Db,
  organizationId: string,
): Promise<SecretaryProfileVersion | undefined> {
  const [version] = await db
    .select()
    .from(secretaryProfileVersions)
    .where(and(eq(secretaryProfileVersions.organizationId, organizationId)))
    .orderBy(desc(secretaryProfileVersions.createdAt))
    .limit(1);

  return version ? parseVersion(version) : undefined;
}

export async function saveOrganizationSecretaryProfileDraft(
  db: Db,
  organizationId: string,
  profile: SecretaryProfile,
): Promise<SecretaryProfileVersion> {
  const parsedProfile = parseSecretaryProfile(profile);
  const [saved] = await db
    .insert(secretaryProfileVersions)
    .values({ organizationId, status: 'draft', profile: parsedProfile })
    .returning();

  if (!saved) throw new Error('Profile version was not saved.');
  return parseVersion(saved);
}

export async function publishOrganizationSecretaryProfile(
  db: Db,
  organizationId: string,
  versionId: string,
): Promise<SecretaryProfileVersion> {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(secretaryProfileVersions)
      .where(and(
        eq(secretaryProfileVersions.organizationId, organizationId),
        eq(secretaryProfileVersions.id, versionId),
      ));

    if (!version) throw new Error('Profile version not found for this context.');

    await tx
      .update(secretaryProfileVersions)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(and(
        eq(secretaryProfileVersions.organizationId, organizationId),
        eq(secretaryProfileVersions.status, 'published'),
      ));

    const [published] = await tx
      .update(secretaryProfileVersions)
      .set({ status: 'published', updatedAt: new Date() })
      .where(and(
        eq(secretaryProfileVersions.organizationId, organizationId),
        eq(secretaryProfileVersions.id, version.id),
      ))
      .returning();

    if (!published) throw new Error('Profile version was not published.');
    return parseVersion(published);
  });
}
