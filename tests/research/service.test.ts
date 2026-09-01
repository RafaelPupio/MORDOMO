import type { Db } from '@/db/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const repository = vi.hoisted(() => ({
  beginProposalAttempt: vi.fn(),
  createResearchBrief: vi.fn(),
  failResearchBrief: vi.fn(),
  getLatestOrganizationResearchDTO: vi.fn(),
  recordDataControlEvent: vi.fn(),
  reviewResearchFact: vi.fn(),
  saveProposedFacts: vi.fn(),
  saveResearchSource: vi.fn(),
}));

vi.mock('@/db/repo/public-research', () => repository);

import { RESEARCH_CONSENT_VERSION } from '@/research/contracts';
import { PublicResearchProviderError } from '@/research/provider';
import {
  getCurrentOrganizationResearch,
  retryOrganizationResearchProposal,
  reviewOrganizationResearchFact,
  startOrganizationResearch,
  type ResearchServiceDeps,
} from '@/research/service';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const BRIEF_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const FACT_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-09-01T12:00:00Z');

const validInput = {
  url: 'https://example.com/about',
  city: 'Fictional City',
  locale: 'en',
  segment: 'clinic',
  consentVersion: RESEARCH_CONSENT_VERSION,
  consent: 'on',
};

function organizationContext() {
  return {
    kind: 'organization' as const,
    userId: 'user_fictional_admin',
    organizationId: ORGANIZATION_ID,
    role: 'admin' as const,
  };
}

function researchBrief(overrides: Record<string, unknown> = {}) {
  return {
    id: BRIEF_ID,
    organizationId: ORGANIZATION_ID,
    requestedByClerkUserId: 'user_fictional_admin',
    segment: 'clinic',
    city: 'Fictional City',
    locale: 'en',
    requestedUrl: 'https://example.com/about',
    consentVersion: RESEARCH_CONSENT_VERSION,
    consentedAt: NOW,
    proposalAttempts: 1,
    status: 'proposing',
    errorCode: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function researchSource() {
  return {
    id: SOURCE_ID,
    organizationId: ORGANIZATION_ID,
    briefId: BRIEF_ID,
    url: 'https://example.com/about',
    title: 'Fictional Clinic',
    excerpt: 'Fictional Clinic opens Monday at 09:00.',
    retrievedAt: NOW,
  };
}

function deps(overrides: Partial<ResearchServiceDeps> = {}): ResearchServiceDeps {
  return {
    db: {} as Db,
    provider: {
      retrieveApprovedPage: vi.fn(async () => ({
        title: 'Fictional Clinic',
        url: 'https://example.com/about',
        excerpt: 'Fictional Clinic opens Monday at 09:00.',
      })),
    },
    propose: vi.fn(async () => ({
      ok: true as const,
      facts: [{ proposedText: 'Open Monday at 09:00.', supportingQuote: 'opens Monday at 09:00' }],
    })),
    resolveContext: vi.fn(async () => organizationContext()),
    rateLimit: vi.fn(async () => ({ allowed: true, remaining: 2 })),
    budget: vi.fn(async () => ({ allowed: true })),
    globalCapUsd: 50,
    now: () => NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RESEARCH_RETENTION_VERIFIED', 'true');
  vi.stubEnv('BROWSERBASE_API_KEY', 'test-key');
  vi.stubEnv('BROWSERBASE_PROJECT_ID', 'test-project');
  repository.createResearchBrief.mockResolvedValue(researchBrief({ proposalAttempts: 0, status: 'retrieving' }));
  repository.saveResearchSource.mockResolvedValue(researchSource());
  repository.beginProposalAttempt.mockResolvedValue({ brief: researchBrief(), source: researchSource() });
  repository.saveProposedFacts.mockResolvedValue(undefined);
  repository.failResearchBrief.mockResolvedValue(researchBrief({ status: 'failed', errorCode: 'proposalFailed' }));
  repository.recordDataControlEvent.mockResolvedValue({ id: crypto.randomUUID() });
  repository.reviewResearchFact.mockResolvedValue({ id: FACT_ID, reviewStatus: 'accepted' });
  repository.getLatestOrganizationResearchDTO.mockResolvedValue({
    available: true,
    briefId: BRIEF_ID,
    status: 'review_ready',
    facts: [],
  });
});

describe('startOrganizationResearch', () => {
  it('orders every trust, cost, durable-state, provider, proposal, and audit boundary', async () => {
    const order: string[] = [];
    const serviceDeps = deps({
      resolveContext: vi.fn(async () => { order.push('auth'); return organizationContext(); }),
      rateLimit: vi.fn(async () => { order.push('rate'); return { allowed: true, remaining: 2 }; }),
      budget: vi.fn(async () => { order.push('budget'); return { allowed: true }; }),
      provider: {
        retrieveApprovedPage: vi.fn(async () => {
          order.push('provider');
          return { title: 'Fictional Clinic', url: 'https://example.com/about', excerpt: 'opens Monday' };
        }),
      },
      propose: vi.fn(async () => {
        order.push('proposer');
        return { ok: true as const, facts: [{ proposedText: 'Open Monday.', supportingQuote: 'opens Monday' }] };
      }),
    });
    repository.createResearchBrief.mockImplementation(async () => {
      order.push('create brief');
      return researchBrief({ status: 'retrieving', proposalAttempts: 0 });
    });
    repository.saveResearchSource.mockImplementation(async () => {
      order.push('source save');
      return researchSource();
    });
    repository.beginProposalAttempt.mockImplementation(async () => {
      order.push('proposal attempt');
      return { brief: researchBrief(), source: researchSource() };
    });
    repository.saveProposedFacts.mockImplementation(async () => { order.push('fact save'); });
    repository.recordDataControlEvent.mockImplementation(async () => {
      order.push('audit');
      return { id: crypto.randomUUID() };
    });

    await expect(startOrganizationResearch(serviceDeps, 'organization', validInput))
      .resolves.toEqual({ ok: true, briefId: BRIEF_ID });

    expect(order).toEqual([
      'auth',
      'rate',
      'budget',
      'create brief',
      'provider',
      'source save',
      'proposal attempt',
      'proposer',
      'fact save',
      'audit',
      'audit',
      'audit',
    ]);
    expect(serviceDeps.rateLimit).toHaveBeenCalledWith(serviceDeps.db, `research:retrieve:${ORGANIZATION_ID}`, {
      limit: 3,
      windowSeconds: 86_400,
      now: NOW,
    });
    expect(serviceDeps.budget).toHaveBeenCalledWith(serviceDeps.db, ORGANIZATION_ID, 50);
    expect(repository.createResearchBrief).toHaveBeenCalledWith(serviceDeps.db, expect.objectContaining({
      organizationId: ORGANIZATION_ID,
      requestedByClerkUserId: 'user_fictional_admin',
      requestedUrl: 'https://example.com/about',
      consentVersion: RESEARCH_CONSENT_VERSION,
      now: NOW,
    }));
    expect(repository.recordDataControlEvent.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ action: 'research.started', outcome: 'succeeded' }),
      expect.objectContaining({ action: 'research.source', outcome: 'succeeded' }),
      expect.objectContaining({ action: 'research.proposed', outcome: 'succeeded' }),
    ]);
  });

  it('authenticates before denying Personal, member, unauthenticated, and forged contexts', async () => {
    for (const [kind, resolveContext] of [
      ['personal', vi.fn(async () => ({ kind: 'personal', userId: 'user', personalContextId: 'personal' }))],
      ['organization', vi.fn(async () => ({ ...organizationContext(), role: 'member' }))],
      ['organization', vi.fn(async () => { throw new Error('Authentication required for user_private'); })],
      ['organization', vi.fn(async () => ({ ...organizationContext(), organizationId: '' }))],
    ] as const) {
      const serviceDeps = deps({ resolveContext: resolveContext as ResearchServiceDeps['resolveContext'] });
      await expect(startOrganizationResearch(serviceDeps, kind, validInput))
        .resolves.toEqual({ ok: false, error: 'forbidden' });
      expect(resolveContext).toHaveBeenCalledOnce();
      expect(serviceDeps.provider.retrieveApprovedPage).not.toHaveBeenCalled();
      expect(serviceDeps.propose).not.toHaveBeenCalled();
    }
  });

  it('denies invalid input and feature configuration before rate, budget, or provider work', async () => {
    const invalidUrl = deps();
    await expect(startOrganizationResearch(invalidUrl, 'organization', {
      ...validInput,
      url: 'https://localhost/private',
    })).resolves.toEqual({ ok: false, error: 'unsafeUrl' });
    expect(invalidUrl.resolveContext).toHaveBeenCalledOnce();
    expect(invalidUrl.rateLimit).not.toHaveBeenCalled();

    const invalidConsent = deps();
    await expect(startOrganizationResearch(invalidConsent, 'organization', {
      ...validInput,
      consentVersion: 'public-research-v1',
    })).resolves.toEqual({ ok: false, error: 'invalidInput' });
    expect(invalidConsent.rateLimit).not.toHaveBeenCalled();

    vi.stubEnv('RESEARCH_RETENTION_VERIFIED', 'false');
    const unverified = deps();
    await expect(startOrganizationResearch(unverified, 'organization', validInput))
      .resolves.toEqual({ ok: false, error: 'retentionUnverified' });
    expect(unverified.rateLimit).not.toHaveBeenCalled();

    vi.stubEnv('RESEARCH_RETENTION_VERIFIED', 'true');
    vi.stubEnv('BROWSERBASE_API_KEY', '');
    const unavailable = deps();
    await expect(startOrganizationResearch(unavailable, 'organization', validInput))
      .resolves.toEqual({ ok: false, error: 'researchUnavailable' });
    expect(unavailable.rateLimit).not.toHaveBeenCalled();
  });

  it('stops before durable or external work on rate and budget denial', async () => {
    const rateDenied = deps({ rateLimit: vi.fn(async () => ({ allowed: false, remaining: 0 })) });
    await expect(startOrganizationResearch(rateDenied, 'organization', validInput))
      .resolves.toEqual({ ok: false, error: 'rateLimited' });
    expect(rateDenied.budget).not.toHaveBeenCalled();
    expect(repository.createResearchBrief).not.toHaveBeenCalled();

    const budgetDenied = deps({ budget: vi.fn(async () => ({ allowed: false, reason: 'tenant' as const })) });
    await expect(startOrganizationResearch(budgetDenied, 'organization', validInput))
      .resolves.toEqual({ ok: false, error: 'budgetExhausted' });
    expect(repository.createResearchBrief).not.toHaveBeenCalled();
    expect(budgetDenied.provider.retrieveApprovedPage).not.toHaveBeenCalled();
  });

  it('marks provider failures with only a stable code and safe log fields', async () => {
    const serviceDeps = deps({
      provider: {
        retrieveApprovedPage: vi.fn(async () => {
          throw new PublicResearchProviderError('providerUnavailable');
        }),
      },
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await startOrganizationResearch(serviceDeps, 'organization', validInput);

    expect(result).toEqual({ ok: false, error: 'providerUnavailable' });
    expect(repository.failResearchBrief).toHaveBeenCalledWith(
      serviceDeps.db,
      ORGANIZATION_ID,
      BRIEF_ID,
      'providerUnavailable',
    );
    expect(log).toHaveBeenCalledWith('public research failed', {
      briefId: BRIEF_ID,
      stage: 'provider',
      code: 'providerUnavailable',
    });
    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).not.toContain(ORGANIZATION_ID);
    expect(serialized).not.toContain('user_fictional_admin');
    expect(serialized).not.toContain(validInput.url);
    log.mockRestore();
  });

  it('retains a saved source and marks a failed proposal with its stable code', async () => {
    const serviceDeps = deps({
      propose: vi.fn(async () => ({ ok: false as const, error: 'ungroundedProposal' as const })),
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(startOrganizationResearch(serviceDeps, 'organization', validInput))
      .resolves.toEqual({ ok: false, error: 'ungroundedProposal' });
    expect(repository.saveResearchSource).toHaveBeenCalledOnce();
    expect(repository.failResearchBrief).toHaveBeenCalledWith(
      serviceDeps.db,
      ORGANIZATION_ID,
      BRIEF_ID,
      'ungroundedProposal',
    );
    expect(repository.saveProposedFacts).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('retryOrganizationResearchProposal', () => {
  it('reuses the stored source and never invokes Browserbase', async () => {
    const serviceDeps = deps();

    await expect(retryOrganizationResearchProposal(serviceDeps, 'organization', BRIEF_ID))
      .resolves.toEqual({ ok: true, briefId: BRIEF_ID });

    expect(serviceDeps.provider.retrieveApprovedPage).not.toHaveBeenCalled();
    expect(serviceDeps.propose).toHaveBeenCalledWith(
      expect.objectContaining({ db: serviceDeps.db }),
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        briefId: BRIEF_ID,
        excerpt: researchSource().excerpt,
      }),
    );
    expect(repository.saveProposedFacts).toHaveBeenCalledOnce();
  });

  it('maps the repository attempt cap to a finite stale-state result', async () => {
    const serviceDeps = deps();
    repository.beginProposalAttempt.mockRejectedValueOnce(new Error('Research brief is not retryable.'));

    await expect(retryOrganizationResearchProposal(serviceDeps, 'organization', BRIEF_ID))
      .resolves.toEqual({ ok: false, error: 'staleResearchState' });
    expect(serviceDeps.provider.retrieveApprovedPage).not.toHaveBeenCalled();
    expect(serviceDeps.propose).not.toHaveBeenCalled();
  });
});

describe('review/read research wrappers', () => {
  it('parses and reviews one scoped fact, then writes metadata-only audit', async () => {
    const serviceDeps = deps();

    await expect(reviewOrganizationResearchFact(serviceDeps, 'organization', {
      decision: 'accept',
      factId: FACT_ID,
      acceptedText: 'Open every Monday.',
    })).resolves.toEqual({ ok: true });

    expect(repository.reviewResearchFact).toHaveBeenCalledWith(
      serviceDeps.db,
      ORGANIZATION_ID,
      'user_fictional_admin',
      { decision: 'accept', factId: FACT_ID, acceptedText: 'Open every Monday.' },
    );
    expect(repository.recordDataControlEvent).toHaveBeenCalledWith(serviceDeps.db, {
      organizationId: ORGANIZATION_ID,
      actorClerkUserId: 'user_fictional_admin',
      action: 'research.reviewed',
      targetType: 'research_fact',
      targetId: FACT_ID,
      outcome: 'succeeded',
    });
  });

  it('rejects Personal and malformed decisions without repository access', async () => {
    const personalDeps = deps({
      resolveContext: vi.fn(async () => ({ kind: 'personal' as const, userId: 'user', personalContextId: 'personal' })),
    });
    await expect(reviewOrganizationResearchFact(personalDeps, 'personal', {
      decision: 'reject', factId: FACT_ID,
    })).resolves.toEqual({ ok: false, error: 'forbidden' });

    const invalidDeps = deps();
    await expect(reviewOrganizationResearchFact(invalidDeps, 'organization', {
      decision: 'accept', factId: FACT_ID, acceptedText: '',
    })).resolves.toEqual({ ok: false, error: 'invalidInput' });
    expect(repository.reviewResearchFact).not.toHaveBeenCalled();
  });

  it('returns a safe Organization DTO, unavailable state, and no Personal DTO', async () => {
    const serviceDeps = deps();
    await expect(getCurrentOrganizationResearch(serviceDeps, 'organization')).resolves.toEqual({
      available: true,
      briefId: BRIEF_ID,
      status: 'review_ready',
      facts: [],
    });
    expect(repository.getLatestOrganizationResearchDTO).toHaveBeenCalledWith(serviceDeps.db, ORGANIZATION_ID);

    vi.stubEnv('BROWSERBASE_PROJECT_ID', '');
    await expect(getCurrentOrganizationResearch(deps(), 'organization')).resolves.toEqual({
      available: false,
      facts: [],
    });
    expect(repository.getLatestOrganizationResearchDTO).toHaveBeenCalledTimes(1);

    const personalDeps = deps({
      resolveContext: vi.fn(async () => ({ kind: 'personal' as const, userId: 'user', personalContextId: 'personal' })),
    });
    await expect(getCurrentOrganizationResearch(personalDeps, 'personal')).resolves.toBeNull();
  });
});
