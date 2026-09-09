import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createResearchServiceDeps,
  refresh,
  reviewOrganizationResearchFact,
  retryOrganizationResearchProposal,
  startOrganizationResearch,
} = vi.hoisted(() => ({
  createResearchServiceDeps: vi.fn(() => ({ dependency: 'trusted' })),
  refresh: vi.fn(),
  reviewOrganizationResearchFact: vi.fn(),
  retryOrganizationResearchProposal: vi.fn(),
  startOrganizationResearch: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ refresh }));
vi.mock('@/research/service', () => ({
  createResearchServiceDeps,
  reviewOrganizationResearchFact,
  retryOrganizationResearchProposal,
  startOrganizationResearch,
}));

function validStartFormData(): FormData {
  const formData = new FormData();
  formData.set('url', ' https://example.com/about ');
  formData.set('city', ' Cuiabá ');
  formData.set('locale', 'pt');
  formData.set('segment', 'church');
  formData.set('consentVersion', 'public-research-v2');
  formData.set('consent', 'on');
  formData.set('organizationId', 'forged-organization-id');
  formData.set('providerOptions', 'forged-provider-options');
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  createResearchServiceDeps.mockReturnValue({ dependency: 'trusted' });
  startOrganizationResearch.mockResolvedValue({
    ok: true,
    briefId: '11111111-1111-4111-8111-111111111111',
  });
  retryOrganizationResearchProposal.mockResolvedValue({
    ok: true,
    briefId: '11111111-1111-4111-8111-111111111111',
  });
  reviewOrganizationResearchFact.mockResolvedValue({ ok: true });
});

describe('research Server Actions', () => {
  it('passes only parsed public input to the research service and refreshes on success', async () => {
    const { startResearchAction } = await import(
      '@/app/[locale]/studio/research-actions'
    );

    await expect(startResearchAction({}, validStartFormData())).resolves.toEqual({
      ok: 'started',
    });
    expect(startOrganizationResearch).toHaveBeenCalledWith(
      { dependency: 'trusted' },
      'organization',
      {
        url: 'https://example.com/about',
        city: 'Cuiabá',
        locale: 'pt',
        segment: 'church',
        consentVersion: 'public-research-v2',
        consent: 'on',
      },
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('returns finite field errors without leaking submitted values', async () => {
    const { startResearchAction } = await import(
      '@/app/[locale]/studio/research-actions'
    );
    const formData = validStartFormData();
    formData.set('url', 'https://submitted.example/private');
    formData.delete('consent');

    const result = await startResearchAction({}, formData);

    expect(result).toEqual({
      error: 'invalidInput',
      fieldErrors: { consent: 'consentRequired' },
    });
    expect(JSON.stringify(result)).not.toContain(
      'https://submitted.example/private',
    );
    expect(startOrganizationResearch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('maps service failures to a stable code without refreshing', async () => {
    const { startResearchAction } = await import(
      '@/app/[locale]/studio/research-actions'
    );
    startOrganizationResearch.mockResolvedValueOnce({
      ok: false,
      error: 'providerUnavailable',
    });

    await expect(startResearchAction({}, validStartFormData())).resolves.toEqual({
      error: 'providerUnavailable',
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('parses a retry brief ID without forwarding extra fields', async () => {
    const { retryResearchAction } = await import(
      '@/app/[locale]/studio/research-actions'
    );
    const formData = new FormData();
    formData.set('briefId', '11111111-1111-4111-8111-111111111111');
    formData.set('sourceExcerpt', 'must never cross the action boundary');

    await expect(retryResearchAction({}, formData)).resolves.toEqual({
      ok: 'retried',
    });
    expect(retryOrganizationResearchProposal).toHaveBeenCalledWith(
      { dependency: 'trusted' },
      'organization',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('rejects malformed retry IDs before constructing service dependencies', async () => {
    const { retryResearchAction } = await import(
      '@/app/[locale]/studio/research-actions'
    );
    const formData = new FormData();
    formData.set('briefId', 'not-a-uuid');

    await expect(retryResearchAction({}, formData)).resolves.toEqual({
      error: 'invalidInput',
    });
    expect(createResearchServiceDeps).not.toHaveBeenCalled();
    expect(retryOrganizationResearchProposal).not.toHaveBeenCalled();
  });

  it.each([
    {
      decision: 'accept',
      acceptedText: '  Fictional organization opens Monday.  ',
      expected: {
        decision: 'accept',
        factId: '22222222-2222-4222-8222-222222222222',
        acceptedText: 'Fictional organization opens Monday.',
      },
    },
    {
      decision: 'reject',
      acceptedText: 'must be dropped',
      expected: {
        decision: 'reject',
        factId: '22222222-2222-4222-8222-222222222222',
      },
    },
  ])('passes only the parsed $decision review decision', async ({
    decision,
    acceptedText,
    expected,
  }) => {
    const { reviewResearchFactAction } = await import(
      '@/app/[locale]/studio/research-actions'
    );
    const formData = new FormData();
    formData.set('decision', decision);
    formData.set('factId', '22222222-2222-4222-8222-222222222222');
    formData.set('acceptedText', acceptedText);
    formData.set('organizationId', 'forged-organization-id');

    await expect(reviewResearchFactAction({}, formData)).resolves.toEqual({
      ok: 'reviewed',
    });
    expect(reviewOrganizationResearchFact).toHaveBeenCalledWith(
      { dependency: 'trusted' },
      'organization',
      expected,
    );
    expect(refresh).toHaveBeenCalledOnce();
  });
});
