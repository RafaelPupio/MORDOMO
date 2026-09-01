import type { Db } from '@/db/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ensureActiveClerkOrganization,
  getDb,
  listAcceptedResearchFacts,
  publishOrganizationSecretaryProfile,
  redirect,
  requireSecretaryContext,
  requireStudioWriteContext,
  saveOrganizationSecretaryProfileDraft,
} = vi.hoisted(() => ({
  ensureActiveClerkOrganization: vi.fn(),
  getDb: vi.fn(() => ({}) as Db),
  listAcceptedResearchFacts: vi.fn(),
  publishOrganizationSecretaryProfile: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {
      digest: `NEXT_REDIRECT;push;${path};303;`,
    });
  }),
  requireSecretaryContext: vi.fn(),
  requireStudioWriteContext: vi.fn(),
  saveOrganizationSecretaryProfileDraft: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect }));

vi.mock('@/core/secretary-context', () => ({
  ensureActiveClerkOrganization,
  requireSecretaryContext,
  requireStudioWriteContext,
}));

vi.mock('@/db/client', () => ({ getDb }));

vi.mock('@/db/repo/secretary-profile-versions', () => ({
  publishOrganizationSecretaryProfile,
  saveOrganizationSecretaryProfileDraft,
}));

vi.mock('@/db/repo/public-research', () => ({ listAcceptedResearchFacts }));

function formWith(overrides: Record<string, string | string[]> = {}) {
  const fields: Record<string, string | string[]> = {
    segment: 'church',
    defaultLocale: 'en',
    assistantName: 'Avery',
    replyTone: 'professional',
    greeting: 'Welcome to the fictional MORDOMO demo.',
    escalationCopy: 'A fictional team member will review this request.',
    enabledCapabilities: ['knowledge', 'escalation'],
    ...overrides,
  };
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      formData.append(name, entry);
    }
  }
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSecretaryContext.mockResolvedValue({
    kind: 'personal',
    userId: 'user_fictional',
    personalContextId: 'personal_fictional',
  });
  requireStudioWriteContext.mockResolvedValue({
    kind: 'organization',
    userId: 'user_fictional',
    organizationId: 'trusted-organization-id',
    role: 'admin',
  });
  ensureActiveClerkOrganization.mockResolvedValue({ id: 'trusted-organization-id' });
  saveOrganizationSecretaryProfileDraft.mockResolvedValue({ id: 'draft-id' });
  publishOrganizationSecretaryProfile.mockResolvedValue({ id: 'published-id' });
  listAcceptedResearchFacts.mockResolvedValue([]);
});

describe('Studio Server Actions', () => {
  it('keeps Personal Secretary configuration browser-local after authenticating the request', async () => {
    const { saveStudioDraft } = await import('@/app/[locale]/studio/actions');

    const state = await saveStudioDraft('personal', formWith({ assistantName: 'Mia' }));

    expect(state).toEqual({ error: 'personalNotSaved' });
    expect(requireSecretaryContext).toHaveBeenCalledWith('personal');
    expect(requireStudioWriteContext).not.toHaveBeenCalled();
    expect(saveOrganizationSecretaryProfileDraft).not.toHaveBeenCalled();
  });

  it('rejects a forged Personal segment on an Organization save', async () => {
    const { saveStudioDraft } = await import('@/app/[locale]/studio/actions');

    const state = await saveStudioDraft(
      'organization',
      formWith({ segment: 'personal' }),
    );

    expect(state).toMatchObject({
      error: 'invalid',
      fieldErrors: { segment: 'personalPreviewOnly' },
    });
    expect(saveOrganizationSecretaryProfileDraft).not.toHaveBeenCalled();
  });

  it('saves a valid Organization draft only inside the Clerk-derived organization', async () => {
    const { saveStudioDraft } = await import('@/app/[locale]/studio/actions');

    const state = await saveStudioDraft('organization', formWith());

    expect(state).toEqual({ ok: 'draftSaved' });
    expect(state).not.toHaveProperty('versionId');
    expect(saveOrganizationSecretaryProfileDraft).toHaveBeenCalledWith(
      expect.anything(),
      'trusted-organization-id',
      expect.objectContaining({ assistantName: 'Avery', segment: 'church' }),
    );
  });

  it('materializes accepted fact IDs server-side and ignores forged citation JSON', async () => {
    const { saveStudioDraft } = await import('@/app/[locale]/studio/actions');
    const acceptedFact = {
      researchFactId: '11111111-1111-4111-8111-111111111111',
      sourceId: '22222222-2222-4222-8222-222222222222',
      text: 'The fictional clinic opens Monday.',
      sourceTitle: 'Fictional Clinic',
      sourceUrl: 'https://example.com/about',
    };
    listAcceptedResearchFacts.mockResolvedValueOnce([acceptedFact]);

    const state = await saveStudioDraft('organization', formWith({
      approvedPublicFactIds: [acceptedFact.researchFactId],
      approvedPublicFacts: JSON.stringify([{
        text: 'forged text',
        sourceUrl: 'https://evil.invalid',
      }]),
    }));

    expect(state).toEqual({ ok: 'draftSaved' });
    expect(listAcceptedResearchFacts).toHaveBeenCalledWith(
      expect.anything(),
      'trusted-organization-id',
      [acceptedFact.researchFactId],
    );
    expect(saveOrganizationSecretaryProfileDraft).toHaveBeenCalledWith(
      expect.anything(),
      'trusted-organization-id',
      expect.objectContaining({ approvedPublicFacts: [acceptedFact] }),
    );
    expect(JSON.stringify(saveOrganizationSecretaryProfileDraft.mock.calls)).not.toContain('forged text');
    expect(JSON.stringify(saveOrganizationSecretaryProfileDraft.mock.calls)).not.toContain('evil.invalid');
  });

  it('rejects missing, cross-Organization, proposed, or rejected fact IDs as one invalid save', async () => {
    const { saveStudioDraft } = await import('@/app/[locale]/studio/actions');
    const requestedIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    listAcceptedResearchFacts.mockResolvedValueOnce([{
      researchFactId: requestedIds[0],
      sourceId: '33333333-3333-4333-8333-333333333333',
      text: 'Only one trusted fact resolved.',
      sourceTitle: 'Fictional Clinic',
      sourceUrl: 'https://example.com/about',
    }]);

    await expect(saveStudioDraft('organization', formWith({
      approvedPublicFactIds: requestedIds,
    }))).resolves.toEqual({ error: 'invalid' });
    expect(saveOrganizationSecretaryProfileDraft).not.toHaveBeenCalled();
  });

  it('deduplicates accepted IDs in submitted order and limits the raw selection to twelve', async () => {
    const { saveStudioDraft } = await import('@/app/[locale]/studio/actions');
    const firstId = '11111111-1111-4111-8111-111111111111';
    const secondId = '22222222-2222-4222-8222-222222222222';
    const snapshots = [
      {
        researchFactId: firstId,
        sourceId: '33333333-3333-4333-8333-333333333333',
        text: 'First submitted fact.',
        sourceTitle: 'Source One',
        sourceUrl: 'https://example.com/one',
      },
      {
        researchFactId: secondId,
        sourceId: '44444444-4444-4444-8444-444444444444',
        text: 'Second submitted fact.',
        sourceTitle: 'Source Two',
        sourceUrl: 'https://example.com/two',
      },
    ];
    listAcceptedResearchFacts.mockResolvedValueOnce(snapshots);

    await expect(saveStudioDraft('organization', formWith({
      approvedPublicFactIds: [firstId, secondId, firstId],
    }))).resolves.toEqual({ ok: 'draftSaved' });
    expect(listAcceptedResearchFacts).toHaveBeenCalledWith(
      expect.anything(),
      'trusted-organization-id',
      [firstId, secondId],
    );
    expect(saveOrganizationSecretaryProfileDraft).toHaveBeenCalledWith(
      expect.anything(),
      'trusted-organization-id',
      expect.objectContaining({ approvedPublicFacts: snapshots }),
    );

    vi.clearAllMocks();
    await expect(saveStudioDraft('organization', formWith({
      approvedPublicFactIds: Array.from({ length: 13 }, (_, index) => (
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      )),
    }))).resolves.toEqual({ error: 'invalid' });
    expect(listAcceptedResearchFacts).not.toHaveBeenCalled();
    expect(saveOrganizationSecretaryProfileDraft).not.toHaveBeenCalled();
  });

  it('returns field validation without exposing submitted content or trusted IDs', async () => {
    const { saveStudioDraft } = await import('@/app/[locale]/studio/actions');
    const submittedValue = 'private-looking-submitted-value';

    const state = await saveStudioDraft(
      'organization',
      formWith({ assistantName: '', greeting: submittedValue }),
    );
    const serialized = JSON.stringify(state);

    expect(state).toMatchObject({
      error: 'invalid',
      fieldErrors: { assistantName: 'reviewField' },
    });
    expect(serialized).not.toContain(submittedValue);
    expect(serialized).not.toContain('trusted-organization-id');
  });

  it('publishes only a version resolved inside the Clerk-derived organization', async () => {
    const { publishStudioProfile } = await import('@/app/[locale]/studio/actions');
    const versionId = '11111111-1111-4111-8111-111111111111';

    await expect(
      publishStudioProfile('organization', versionId),
    ).resolves.toEqual({ ok: 'published' });
    expect(publishOrganizationSecretaryProfile).toHaveBeenCalledWith(
      expect.anything(),
      'trusted-organization-id',
      versionId,
    );
  });

  it('sanitizes denied and missing Organization action failures', async () => {
    const { publishStudioProfile, saveStudioDraft } = await import(
      '@/app/[locale]/studio/actions'
    );
    requireStudioWriteContext.mockRejectedValueOnce(
      new Error('Studio access denied for user_private and org_private'),
    );

    await expect(saveStudioDraft('organization', formWith())).resolves.toEqual({
      error: 'forbidden',
    });

    requireStudioWriteContext.mockResolvedValueOnce({
      kind: 'organization',
      organizationId: 'trusted-organization-id',
    });
    publishOrganizationSecretaryProfile.mockRejectedValueOnce(
      new Error('Profile 11111111-1111-4111-8111-111111111111 was not found.'),
    );

    await expect(
      publishStudioProfile('organization', '11111111-1111-4111-8111-111111111111'),
    ).resolves.toEqual({ error: 'notFound' });
  });

  it('rejects unknown contexts and malformed version identifiers without repository access', async () => {
    const { publishStudioProfile, saveStudioDraft } = await import(
      '@/app/[locale]/studio/actions'
    );

    await expect(
      saveStudioDraft('forged' as 'organization', formWith()),
    ).resolves.toEqual({ error: 'notFound' });
    await expect(
      publishStudioProfile('organization', 'not-a-version-id'),
    ).resolves.toEqual({ error: 'invalid' });
    expect(saveOrganizationSecretaryProfileDraft).not.toHaveBeenCalled();
    expect(publishOrganizationSecretaryProfile).not.toHaveBeenCalled();
  });

  it('authenticates Personal publish attempts without accessing Organization profiles', async () => {
    const { publishStudioProfile } = await import('@/app/[locale]/studio/actions');

    await expect(
      publishStudioProfile('personal', '11111111-1111-4111-8111-111111111111'),
    ).resolves.toEqual({ error: 'personalNotSaved' });
    expect(requireSecretaryContext).toHaveBeenCalledWith('personal');
    expect(publishOrganizationSecretaryProfile).not.toHaveBeenCalled();
  });
});

describe('onboarding Server Action', () => {
  it('establishes Personal context before redirecting to the canonical Studio route', async () => {
    const { enterSecretaryContext } = await import(
      '@/app/[locale]/onboarding/actions'
    );

    await expect(enterSecretaryContext('pt', 'personal')).rejects.toMatchObject({
      digest: expect.stringContaining('/pt/studio?context=personal'),
    });
    expect(requireSecretaryContext).toHaveBeenCalledWith('personal');
  });

  it('onboards only the active Clerk organization before redirecting', async () => {
    const { enterSecretaryContext } = await import(
      '@/app/[locale]/onboarding/actions'
    );

    await expect(enterSecretaryContext('en', 'organization')).rejects.toMatchObject({
      digest: expect.stringContaining('/en/studio?context=organization'),
    });
    expect(ensureActiveClerkOrganization).toHaveBeenCalledWith(expect.anything());
  });

  it('returns a constrained Organization-selection error without leaking Clerk details', async () => {
    const { enterSecretaryContext } = await import(
      '@/app/[locale]/onboarding/actions'
    );
    ensureActiveClerkOrganization.mockRejectedValueOnce(
      new Error('Select org_private_123 for user_private_456 first.'),
    );

    const state = await enterSecretaryContext('en', 'organization');

    expect(state).toEqual({ error: 'organizationRequired' });
    expect(JSON.stringify(state)).not.toContain('org_private_123');
    expect(JSON.stringify(state)).not.toContain('user_private_456');
  });
});
