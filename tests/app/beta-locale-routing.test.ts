import type { Db } from '@/db/client';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDb,
  getLatestOrganizationSecretaryProfile,
  notFound,
  organizationSwitcher,
  redirect,
  requireSecretaryContext,
  requireStudioWriteContext,
} = vi.hoisted(() => ({
  getDb: vi.fn(() => ({}) as Db),
  getLatestOrganizationSecretaryProfile: vi.fn(),
  notFound: vi.fn(() => {
    throw Object.assign(new Error('NEXT_NOT_FOUND'), {
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
  }),
  organizationSwitcher: vi.fn(() => null),
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {
      digest: `NEXT_REDIRECT;replace;${path};307;`,
    });
  }),
  requireSecretaryContext: vi.fn(),
  requireStudioWriteContext: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound, redirect }));
vi.mock('@/core/secretary-context', () => ({
  requireSecretaryContext,
  requireStudioWriteContext,
}));
vi.mock('@/db/client', () => ({ getDb }));
vi.mock('@/db/repo/secretary-profile-versions', () => ({
  getLatestOrganizationSecretaryProfile,
}));
vi.mock('@clerk/nextjs', () => ({ OrganizationSwitcher: organizationSwitcher }));

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
  getLatestOrganizationSecretaryProfile.mockResolvedValue(undefined);
});

describe('beta locale routing', () => {
  it('renders the context choices as one named pressed-button group and hides Clerk Personal accounts', async () => {
    const { ContextPicker } = await import('@/components/studio/context-picker');

    const markup = renderToStaticMarkup(createElement(ContextPicker, {
      locale: 'en',
      messages: (await import('@/i18n/beta-messages')).getBetaMessages('en'),
    }));

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Choose a secretary context"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false"');
    expect(organizationSwitcher).toHaveBeenCalledWith(
      expect.objectContaining({ hidePersonal: true }),
      undefined,
    );
  });

  it.each(['en', 'pt'])('renders onboarding at the supported %s locale', async (locale) => {
    const { default: OnboardingPage } = await import(
      '@/app/[locale]/onboarding/page'
    );

    const result = await OnboardingPage({
      params: Promise.resolve({ locale }),
    });

    expect(result).toEqual(expect.objectContaining({
      props: expect.objectContaining({ locale }),
    }));
  });

  it.each(['fr', 'es', 'de', 'EN'])('returns not found for the unsupported %s onboarding locale', async (locale) => {
    const { default: OnboardingPage } = await import(
      '@/app/[locale]/onboarding/page'
    );

    await expect(OnboardingPage({
      params: Promise.resolve({ locale }),
    })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it.each(['fr', 'es', 'de', 'EN'])('returns not found for the unsupported %s Studio locale', async (locale) => {
    const { default: StudioPage } = await import('@/app/[locale]/studio/page');

    await expect(StudioPage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({ context: 'personal' }),
    })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(requireSecretaryContext).not.toHaveBeenCalled();
    expect(requireStudioWriteContext).not.toHaveBeenCalled();
  });

  it('uses Personal query context only to select the authenticated browser-local branch', async () => {
    const { default: StudioPage } = await import('@/app/[locale]/studio/page');

    const result = await StudioPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ context: 'personal' }),
    });

    expect(requireSecretaryContext).toHaveBeenCalledWith('personal');
    expect(requireStudioWriteContext).not.toHaveBeenCalled();
    expect(getLatestOrganizationSecretaryProfile).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      props: expect.objectContaining({ kind: 'personal', versionId: undefined }),
    }));
  });

  it('loads an Organization profile only with the Clerk-derived organization ID', async () => {
    const { default: StudioPage } = await import('@/app/[locale]/studio/page');
    getLatestOrganizationSecretaryProfile.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      profile: {
        segment: 'general',
        defaultLocale: 'en',
        assistantName: 'Avery',
        replyTone: 'professional',
        greeting: 'Welcome to the fictional demo.',
        escalationCopy: 'A fictional team member will review this request.',
        enabledCapabilities: ['knowledge', 'escalation'],
      },
    });

    const result = await StudioPage({
      params: Promise.resolve({ locale: 'pt' }),
      searchParams: Promise.resolve({ context: 'organization' }),
    });

    expect(getLatestOrganizationSecretaryProfile).toHaveBeenCalledWith(
      expect.anything(),
      'trusted-organization-id',
    );
    expect(result).toEqual(expect.objectContaining({
      props: expect.objectContaining({
        kind: 'organization',
        versionId: '11111111-1111-4111-8111-111111111111',
      }),
    }));
  });

  it('returns not found before authorization when query context is malformed or repeated', async () => {
    const { default: StudioPage } = await import('@/app/[locale]/studio/page');

    await expect(StudioPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ context: 'forged' }),
    })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    await expect(StudioPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ context: ['organization', 'personal'] }),
    })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(requireSecretaryContext).not.toHaveBeenCalled();
    expect(requireStudioWriteContext).not.toHaveBeenCalled();
  });

  it('redirects unlocalized account routes to canonical English paths', async () => {
    const { default: OnboardingRedirect } = await import('@/app/onboarding/page');
    const { default: StudioRedirect } = await import('@/app/studio/page');

    expect(() => OnboardingRedirect()).toThrowError('NEXT_REDIRECT');
    expect(redirect).toHaveBeenLastCalledWith('/en/onboarding');
    expect(() => StudioRedirect()).toThrowError('NEXT_REDIRECT');
    expect(redirect).toHaveBeenLastCalledWith('/en/studio');
  });

  it('keeps the public localized portfolio component unchanged', async () => {
    vi.doMock('@/components/marketing/mordomo-home', () => ({
      MordomoHome: vi.fn((props) => createElement('main', props)),
    }));
    const { default: LocalizedHome } = await import('@/app/[locale]/page');

    const result = await LocalizedHome({
      params: Promise.resolve({ locale: 'fr' }),
    });

    expect(result.props.locale).toBe('fr');
  });
});
