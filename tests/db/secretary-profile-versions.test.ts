import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { SecretaryProfile } from '@/core/secretary-profile';
import {
  getLatestOrganizationSecretaryProfile,
  publishOrganizationSecretaryProfile,
  saveOrganizationSecretaryProfileDraft,
} from '@/db/repo/secretary-profile-versions';
import { secretaryProfileVersions } from '@/db/schema';
import { createTestDb, seedOrganization } from '../helpers/db';

const profile: SecretaryProfile = {
  segment: 'church',
  defaultLocale: 'pt',
  assistantName: 'Mia',
  replyTone: 'warm',
  greeting: 'Olá! Como posso ajudar?',
  escalationCopy: 'Vou encaminhar sua mensagem.',
  enabledCapabilities: ['knowledge', 'escalation'],
};

describe('secretary profile versions repository', () => {
  it('stores each Organization draft as a separate immutable history row', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);

    const first = await saveOrganizationSecretaryProfileDraft(db, organization.id, profile);
    const second = await saveOrganizationSecretaryProfileDraft(db, organization.id, {
      ...profile,
      assistantName: 'Lia',
    });

    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('draft');
    expect((await getLatestOrganizationSecretaryProfile(db, organization.id))?.profile.assistantName).toBe('Lia');
  });

  it('parses stored profile JSON before returning it', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);

    await db.insert(secretaryProfileVersions).values({
      organizationId: organization.id,
      status: 'draft',
      profile: { ...profile, privateNotes: 'must not be read' },
    });

    await expect(getLatestOrganizationSecretaryProfile(db, organization.id)).rejects.toThrow();
  });

  it('rejects publishing a profile version outside the selected Organization', async () => {
    const db = await createTestDb();
    const organizationA = await seedOrganization(db);
    const organizationB = await seedOrganization(db);
    const organizationBDraft = await saveOrganizationSecretaryProfileDraft(db, organizationB.id, profile);

    await expect(
      publishOrganizationSecretaryProfile(db, organizationA.id, organizationBDraft.id),
    ).rejects.toThrow('Profile version not found for this context.');

    expect(await getLatestOrganizationSecretaryProfile(db, organizationB.id)).toMatchObject({
      id: organizationBDraft.id,
      status: 'draft',
    });
  });

  it('replaces only the selected Organization published version', async () => {
    const db = await createTestDb();
    const organizationA = await seedOrganization(db);
    const organizationB = await seedOrganization(db);
    const organizationADraft = await saveOrganizationSecretaryProfileDraft(db, organizationA.id, profile);
    const organizationBDraft = await saveOrganizationSecretaryProfileDraft(db, organizationB.id, {
      ...profile,
      assistantName: 'Lia',
    });

    const first = await publishOrganizationSecretaryProfile(db, organizationA.id, organizationADraft.id);
    await publishOrganizationSecretaryProfile(db, organizationB.id, organizationBDraft.id);

    expect((await getLatestOrganizationSecretaryProfile(db, organizationA.id))?.id).toBe(first.id);
    expect((await getLatestOrganizationSecretaryProfile(db, organizationB.id))?.id).toBe(organizationBDraft.id);
  });

  it('publishes without callback transactions for Neon HTTP compatibility', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);
    const current = await saveOrganizationSecretaryProfileDraft(db, organization.id, profile);
    const target = await saveOrganizationSecretaryProfileDraft(db, organization.id, {
      ...profile,
      assistantName: 'Lia',
    });
    await publishOrganizationSecretaryProfile(db, organization.id, current.id);
    vi.spyOn(db, 'transaction').mockRejectedValue(
      new Error('No transactions support in neon-http driver'),
    );

    await expect(
      publishOrganizationSecretaryProfile(db, organization.id, target.id),
    ).resolves.toMatchObject({ id: target.id, status: 'published' });

    const published = await db
      .select()
      .from(secretaryProfileVersions)
      .where(and(
        eq(secretaryProfileVersions.organizationId, organization.id),
        eq(secretaryProfileVersions.status, 'published'),
      ));
    expect(published.map((version) => version.id)).toEqual([target.id]);
  });

  it('does not demote the published version when the target is absent', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);
    const current = await saveOrganizationSecretaryProfileDraft(db, organization.id, profile);
    await publishOrganizationSecretaryProfile(db, organization.id, current.id);

    await expect(
      publishOrganizationSecretaryProfile(
        db,
        organization.id,
        '11111111-1111-4111-8111-111111111111',
      ),
    ).rejects.toThrow('Profile version not found for this context.');

    const [unchanged] = await db
      .select()
      .from(secretaryProfileVersions)
      .where(eq(secretaryProfileVersions.id, current.id));
    expect(unchanged?.status).toBe('published');
  });

  it('enforces one published version per Organization at the database boundary', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);
    await db.insert(secretaryProfileVersions).values({
      organizationId: organization.id,
      status: 'published',
      profile,
    });

    await expect(db.insert(secretaryProfileVersions).values({
      organizationId: organization.id,
      status: 'published',
      profile: { ...profile, assistantName: 'Lia' },
    })).rejects.toThrow();
  });
});
