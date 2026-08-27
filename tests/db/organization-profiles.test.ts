import { describe, expect, it } from 'vitest';
import { getOrganizationProfile, upsertOrganizationProfile } from '@/db/repo/organization-profiles';
import { createTestDb, seedOrganization } from '../helpers/db';

describe('organization profile repository', () => {
  it('stores and loads a secretary profile only for its organization', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);
    const otherOrganization = await seedOrganization(db);

    await upsertOrganizationProfile(db, organization.id, {
      industry: 'clinic',
      defaultLocale: 'fr',
      assistantName: 'Camille',
      replyTone: 'professional',
      greeting: 'Bonjour, comment puis-je vous aider ?',
      escalationCopy: 'Je vais transmettre votre message à notre équipe.',
      enabledCapabilities: ['knowledge', 'escalation'],
    });

    expect(await getOrganizationProfile(db, organization.id)).toMatchObject({
      organizationId: organization.id,
      assistantName: 'Camille',
      defaultLocale: 'fr',
    });
    expect(await getOrganizationProfile(db, otherOrganization.id)).toBeUndefined();
  });
});
