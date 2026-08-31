import { and, desc, eq, exists, ne, sql } from 'drizzle-orm';
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
  const target = db.$with('publish_target').as(
    db
      .select({ id: secretaryProfileVersions.id })
      .from(secretaryProfileVersions)
      .where(and(
        eq(secretaryProfileVersions.organizationId, organizationId),
        eq(secretaryProfileVersions.id, versionId),
      )),
  );
  const updatedAt = new Date();
  const demoted = db.$with('demoted_profiles').as(
    db
      .update(secretaryProfileVersions)
      .set({ status: 'draft', updatedAt })
      .where(and(
        eq(secretaryProfileVersions.organizationId, organizationId),
        eq(secretaryProfileVersions.status, 'published'),
        ne(secretaryProfileVersions.id, versionId),
        exists(db.select().from(target)),
      ))
      .returning({ id: secretaryProfileVersions.id }),
  );

  const published = db.$with('published_profile').as(
    db
    .update(secretaryProfileVersions)
    .set({ status: 'published', updatedAt })
    .where(and(
      eq(secretaryProfileVersions.organizationId, organizationId),
      eq(secretaryProfileVersions.id, versionId),
      // Reading the data-modifying CTE makes the demotion complete before this update.
      // The predicate is intentionally tautological; it supplies execution ordering.
      sql`(select count(*) from ${demoted}) >= 0`,
    ))
      .returning(),
  );

  const [result] = await db
    .with(target, demoted, published)
    .select({
      targetId: target.id,
      published: {
        id: published.id,
        organizationId: published.organizationId,
        status: published.status,
        profile: published.profile,
        createdAt: published.createdAt,
        updatedAt: published.updatedAt,
      },
    })
    .from(target)
    .leftJoin(published, eq(target.id, published.id));

  if (!result) throw new Error('Profile version not found for this context.');
  if (!result.published) throw new Error('Profile version was not published.');
  return parseVersion(result.published);
}
