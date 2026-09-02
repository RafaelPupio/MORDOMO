import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OrganizationResearchDTO } from '@/research/contracts';

const {
  retryResearchAction,
  reviewResearchFactAction,
  startResearchAction,
} = vi.hoisted(() => ({
  retryResearchAction: vi.fn(),
  reviewResearchFactAction: vi.fn(),
  startResearchAction: vi.fn(),
}));

vi.mock('@/app/[locale]/studio/research-actions', () => ({
  retryResearchAction,
  reviewResearchFactAction,
  startResearchAction,
}));
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ refresh: vi.fn() })),
}));

const FACT_ID = '11111111-1111-4111-8111-111111111111';

async function renderPanel(research: OrganizationResearchDTO, locale: 'en' | 'pt' = 'en') {
  const { OrganizationResearchPanel } = await import(
    '@/components/studio/organization-research-panel'
  );
  return renderToStaticMarkup(createElement(OrganizationResearchPanel, {
    initialAppliedFactIds: [],
    locale,
    onApply: vi.fn(),
    research,
    responseLocale: locale,
    segment: 'church',
  }));
}

describe('Organization research panel', () => {
  it('shows no URL input or action when research is unavailable', async () => {
    const markup = await renderPanel({ available: false, facts: [] });

    expect(markup).toContain('Public research is not available');
    expect(markup).not.toContain('name="url"');
    expect(markup).not.toContain('<button');
  });

  it('renders bounded inputs, current profile context, and exact consent when ready', async () => {
    const markup = await renderPanel({ available: true, facts: [] });

    expect(markup).toContain('name="url"');
    expect(markup).toContain('name="city"');
    expect(markup).toMatch(/<input(?=[^>]*type="hidden")(?=[^>]*name="segment")(?=[^>]*value="church")/);
    expect(markup).toMatch(/<input(?=[^>]*type="hidden")(?=[^>]*name="locale")(?=[^>]*value="en")/);
    expect(markup).toMatch(/<input(?=[^>]*type="hidden")(?=[^>]*name="consentVersion")(?=[^>]*value="public-research-v2")/);
    expect(markup).toContain('I confirm this is a public website');
    expect(markup).toContain('Start public research');
  });

  it.each([
    ['retrieving', 'Retrieving public source'],
    ['source_ready', 'Proposing grounded facts'],
    ['proposing', 'Proposing grounded facts'],
  ] as const)('renders the finite %s running stage', async (status, copy) => {
    const markup = await renderPanel({ available: true, status, facts: [] });

    expect(markup).toContain(copy);
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('name="url"');
  });

  it('renders only safe source fields and all fact review controls', async () => {
    const research = {
      available: true,
      briefId: '22222222-2222-4222-8222-222222222222',
      status: 'review_ready',
      source: {
        title: 'Fictional Community Guide',
        url: 'https://example.com/about',
        excerpt: 'PROVIDER EXCERPT MUST NOT RENDER',
      },
      facts: [{
        id: FACT_ID,
        proposedText: 'The fictional community opens Monday.',
        supportingQuote: 'opens Monday',
        reviewStatus: 'proposed',
      }],
    } as unknown as OrganizationResearchDTO;

    const markup = await renderPanel(research);

    expect(markup).toContain('Fictional Community Guide');
    expect(markup).toContain('href="https://example.com/about"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer noopener"');
    expect(markup).toContain('The fictional community opens Monday.');
    expect(markup).toContain('“opens Monday”');
    expect(markup).toContain('Accept unchanged');
    expect(markup).toContain('Edit and accept');
    expect(markup).toContain('Reject');
    expect(markup).not.toContain('PROVIDER EXCERPT MUST NOT RENDER');
  });

  it('offers a fresh approved URL after a grounded run returns no facts', async () => {
    const markup = await renderPanel({
      available: true,
      briefId: '22222222-2222-4222-8222-222222222222',
      status: 'review_ready',
      source: { title: 'Thin public page', url: 'https://example.com' },
      facts: [],
    });

    expect(markup).toContain('No grounded facts were found');
    expect(markup).toContain('Thin public page');
    expect(markup).toContain('name="url"');
    expect(markup).toContain('name="consent"');
    expect(markup).toContain('Start public research');
  });

  it('offers proposal retry without another URL when a failed brief kept its source', async () => {
    const markup = await renderPanel({
      available: true,
      briefId: '22222222-2222-4222-8222-222222222222',
      status: 'failed',
      error: 'proposalFailed',
      source: { title: 'Saved source', url: 'https://example.com/about' },
      facts: [],
    });

    expect(markup).toContain('Retry fact proposals');
    expect(markup).toContain('name="briefId"');
    expect(markup).not.toContain('name="url"');
  });

  it('renders accepted fact IDs inside the Organization profile Save form only', async () => {
    const { SecretaryStudio } = await import(
      '@/components/studio/secretary-studio'
    );
    const { getBetaMessages } = await import('@/i18n/beta-messages');
    const common = {
      locale: 'en' as const,
      messages: getBetaMessages('en'),
      versionId: '33333333-3333-4333-8333-333333333333',
    };
    const organizationMarkup = renderToStaticMarkup(createElement(SecretaryStudio, {
      ...common,
      initialProfile: {
        segment: 'church',
        defaultLocale: 'en',
        assistantName: 'Avery',
        replyTone: 'professional',
        greeting: 'Welcome.',
        escalationCopy: 'A person will review this.',
        enabledCapabilities: ['knowledge', 'escalation'],
        approvedPublicFacts: [{
          researchFactId: FACT_ID,
          sourceId: '44444444-4444-4444-8444-444444444444',
          text: 'Open Monday.',
          sourceTitle: 'Fictional source',
          sourceUrl: 'https://example.com/about',
        }],
      },
      kind: 'organization',
      research: { available: true, facts: [] },
    }));
    const personalMarkup = renderToStaticMarkup(createElement(SecretaryStudio, {
      ...common,
      initialProfile: {
        segment: 'personal',
        defaultLocale: 'en',
        assistantName: 'Mia',
        replyTone: 'warm',
        greeting: 'Welcome.',
        escalationCopy: 'I cannot do that.',
        enabledCapabilities: ['knowledge', 'escalation'],
        approvedPublicFacts: [],
      },
      kind: 'personal',
    }));

    expect(organizationMarkup).toMatch(
      new RegExp(`<input(?=[^>]*type="hidden")(?=[^>]*name="approvedPublicFactIds")(?=[^>]*value="${FACT_ID}")`),
    );
    expect(organizationMarkup).toContain('Public fact research');
    expect(personalMarkup).not.toContain('Public fact research');
    expect(personalMarkup).not.toContain('public-research-v2');
    expect(personalMarkup).not.toContain('name="url"');
    expect(personalMarkup).not.toContain('approvedPublicFactIds');
  });
});
