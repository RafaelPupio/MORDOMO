import 'server-only';

import { z } from 'zod';
import { checkBudget } from '@/ai/usage';
import { checkRateLimit } from '@/core/rate-limit';
import { requireStudioWriteContext } from '@/core/secretary-context';
import {
  betaLocaleSchema,
  secretaryContextKindSchema,
  type SecretaryContextKind,
} from '@/core/secretary-profile';
import type { Db } from '@/db/client';
import {
  beginProposalAttempt,
  createResearchBrief,
  failResearchBrief,
  getLatestOrganizationResearchDTO,
  recordDataControlEvent,
  reviewResearchFact,
  saveProposedFacts,
  saveResearchSource,
} from '@/db/repo/public-research';
import {
  organizationResearchSegmentSchema,
  publicResearchInputSchema,
  reviewDecisionSchema,
  type OrganizationResearchDTO,
  type ResearchErrorCode,
} from '@/research/contracts';
import { proposePublicFacts } from '@/research/fact-proposer';
import {
  PublicResearchProviderError,
  type PublicResearchProvider,
} from '@/research/provider';
import { parseApprovedPublicUrl } from '@/research/url-policy';

export type ResearchServiceDeps = {
  db: Db;
  provider: PublicResearchProvider;
  propose: typeof proposePublicFacts;
  resolveContext: typeof requireStudioWriteContext;
  rateLimit: typeof checkRateLimit;
  budget: typeof checkBudget;
  globalCapUsd: number;
  now?: () => Date;
};

type OrganizationAccess = {
  organizationId: string;
  actorClerkUserId: string;
};

type ResearchMutationResult =
  | { ok: true; briefId: string }
  | { ok: false; error: ResearchErrorCode };

function availabilityError(): ResearchErrorCode | undefined {
  if (process.env.RESEARCH_RETENTION_VERIFIED !== 'true') return 'retentionUnverified';
  if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
    return 'researchUnavailable';
  }
  return undefined;
}

async function resolveOrganizationAccess(
  deps: ResearchServiceDeps,
  kindInput: unknown,
): Promise<
  | { ok: true; kind: SecretaryContextKind; access: OrganizationAccess }
  | { ok: false; error: 'invalidInput' | 'forbidden'; personal: boolean }
> {
  const kind = secretaryContextKindSchema.safeParse(kindInput);
  if (!kind.success) return { ok: false, error: 'invalidInput', personal: false };

  let context: Awaited<ReturnType<typeof requireStudioWriteContext>>;
  try {
    context = await deps.resolveContext(kind.data);
  } catch {
    return { ok: false, error: 'forbidden', personal: kind.data === 'personal' };
  }

  if (
    kind.data !== 'organization'
    || context.kind !== 'organization'
    || !context.organizationId
    || !context.userId
    || (context.role !== 'owner' && context.role !== 'admin')
  ) {
    return { ok: false, error: 'forbidden', personal: kind.data === 'personal' };
  }

  return {
    ok: true,
    kind: kind.data,
    access: {
      organizationId: context.organizationId,
      actorClerkUserId: context.userId,
    },
  };
}

function safeFailureLog(briefId: string, stage: string, code: ResearchErrorCode): void {
  console.error('public research failed', { briefId, stage, code });
}

async function auditBrief(
  deps: ResearchServiceDeps,
  access: OrganizationAccess,
  briefId: string,
  action: 'research.started' | 'research.source' | 'research.proposed',
  outcome: 'succeeded' | 'failed',
): Promise<void> {
  await recordDataControlEvent(deps.db, {
    organizationId: access.organizationId,
    actorClerkUserId: access.actorClerkUserId,
    action,
    targetType: 'research_brief',
    targetId: briefId,
    outcome,
  });
}

async function markFailed(
  deps: ResearchServiceDeps,
  access: OrganizationAccess,
  briefId: string,
  code: ResearchErrorCode,
  stage: string,
): Promise<void> {
  try {
    await failResearchBrief(deps.db, access.organizationId, briefId, code);
  } catch {
    // The original finite failure remains the public result; a stale state must not leak.
  }
  safeFailureLog(briefId, stage, code);
}

async function recordStartFailureAudit(
  deps: ResearchServiceDeps,
  access: OrganizationAccess,
  briefId: string,
  stage: 'provider' | 'proposal',
): Promise<void> {
  try {
    await auditBrief(deps, access, briefId, 'research.started', 'succeeded');
    if (stage === 'provider') {
      await auditBrief(deps, access, briefId, 'research.source', 'failed');
    } else {
      await auditBrief(deps, access, briefId, 'research.source', 'succeeded');
      await auditBrief(deps, access, briefId, 'research.proposed', 'failed');
    }
  } catch {
    // Audit failure cannot safely undo already-persisted research state.
  }
}

async function proposalForStoredSource(
  deps: ResearchServiceDeps,
  access: OrganizationAccess,
  briefId: string,
): Promise<ResearchMutationResult> {
  let attempt: Awaited<ReturnType<typeof beginProposalAttempt>>;
  try {
    attempt = await beginProposalAttempt(deps.db, access.organizationId, briefId);
  } catch {
    return { ok: false, error: 'staleResearchState' };
  }

  const locale = betaLocaleSchema.safeParse(attempt.brief.locale);
  const segment = organizationResearchSegmentSchema.safeParse(attempt.brief.segment);
  if (!locale.success || !segment.success) {
    await markFailed(deps, access, briefId, 'proposalFailed', 'proposal');
    return { ok: false, error: 'proposalFailed' };
  }

  let proposal: Awaited<ReturnType<typeof proposePublicFacts>>;
  try {
    proposal = await deps.propose(
      { db: deps.db },
      {
        organizationId: access.organizationId,
        briefId,
        locale: locale.data,
        segment: segment.data,
        city: attempt.brief.city ?? undefined,
        excerpt: attempt.source.excerpt,
      },
    );
  } catch {
    proposal = { ok: false, error: 'proposalFailed' };
  }

  if (!proposal.ok) {
    await markFailed(deps, access, briefId, proposal.error, 'proposal');
    return proposal;
  }

  try {
    await saveProposedFacts(
      deps.db,
      access.organizationId,
      briefId,
      attempt.source.id,
      proposal.facts,
    );
  } catch {
    await markFailed(deps, access, briefId, 'proposalFailed', 'proposal');
    return { ok: false, error: 'proposalFailed' };
  }

  return { ok: true, briefId };
}

export async function startOrganizationResearch(
  deps: ResearchServiceDeps,
  kindInput: unknown,
  input: unknown,
): Promise<ResearchMutationResult> {
  const resolved = await resolveOrganizationAccess(deps, kindInput);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { access } = resolved;

  const parsed = publicResearchInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalidInput' };

  let requestedUrl: URL;
  try {
    requestedUrl = parseApprovedPublicUrl(parsed.data.url);
  } catch {
    return { ok: false, error: 'unsafeUrl' };
  }

  const unavailable = availabilityError();
  if (unavailable) return { ok: false, error: unavailable };

  let rate: Awaited<ReturnType<typeof checkRateLimit>>;
  try {
    rate = await deps.rateLimit(deps.db, `research:retrieve:${access.organizationId}`, {
      limit: 3,
      windowSeconds: 86_400,
      now: deps.now?.() ?? new Date(),
    });
  } catch {
    return { ok: false, error: 'rateLimited' };
  }
  if (!rate.allowed) return { ok: false, error: 'rateLimited' };

  let budget: Awaited<ReturnType<typeof checkBudget>>;
  try {
    budget = await deps.budget(deps.db, access.organizationId, deps.globalCapUsd);
  } catch {
    return { ok: false, error: 'budgetExhausted' };
  }
  if (!budget.allowed) return { ok: false, error: 'budgetExhausted' };

  const now = deps.now?.() ?? new Date();
  let brief: Awaited<ReturnType<typeof createResearchBrief>>;
  try {
    brief = await createResearchBrief(deps.db, {
      organizationId: access.organizationId,
      requestedByClerkUserId: access.actorClerkUserId,
      segment: parsed.data.segment,
      city: parsed.data.city,
      locale: parsed.data.locale,
      requestedUrl: requestedUrl.toString(),
      consentVersion: parsed.data.consentVersion,
      now,
    });
  } catch {
    return { ok: false, error: 'staleResearchState' };
  }

  let retrieved: Awaited<ReturnType<PublicResearchProvider['retrieveApprovedPage']>>;
  try {
    retrieved = await deps.provider.retrieveApprovedPage(requestedUrl);
  } catch (error) {
    const code = error instanceof PublicResearchProviderError
      ? error.code
      : 'providerUnavailable';
    await markFailed(deps, access, brief.id, code, 'provider');
    await recordStartFailureAudit(deps, access, brief.id, 'provider');
    return { ok: false, error: code };
  }

  try {
    await saveResearchSource(deps.db, access.organizationId, brief.id, retrieved);
  } catch {
    await markFailed(deps, access, brief.id, 'providerUnavailable', 'provider');
    await recordStartFailureAudit(deps, access, brief.id, 'provider');
    return { ok: false, error: 'providerUnavailable' };
  }

  const proposal = await proposalForStoredSource(deps, access, brief.id);
  if (!proposal.ok) {
    await recordStartFailureAudit(deps, access, brief.id, 'proposal');
    return proposal;
  }

  try {
    await auditBrief(deps, access, brief.id, 'research.started', 'succeeded');
    await auditBrief(deps, access, brief.id, 'research.source', 'succeeded');
    await auditBrief(deps, access, brief.id, 'research.proposed', 'succeeded');
  } catch {
    safeFailureLog(brief.id, 'audit', 'proposalFailed');
    return { ok: false, error: 'proposalFailed' };
  }
  return proposal;
}

export async function retryOrganizationResearchProposal(
  deps: ResearchServiceDeps,
  kindInput: unknown,
  briefIdInput: unknown,
): Promise<ResearchMutationResult> {
  const resolved = await resolveOrganizationAccess(deps, kindInput);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const unavailable = availabilityError();
  if (unavailable) return { ok: false, error: unavailable };

  const briefId = z.uuid().safeParse(briefIdInput);
  if (!briefId.success) return { ok: false, error: 'invalidInput' };

  try {
    const budget = await deps.budget(deps.db, resolved.access.organizationId, deps.globalCapUsd);
    if (!budget.allowed) return { ok: false, error: 'budgetExhausted' };
  } catch {
    return { ok: false, error: 'budgetExhausted' };
  }

  const proposal = await proposalForStoredSource(deps, resolved.access, briefId.data);
  try {
    await auditBrief(
      deps,
      resolved.access,
      briefId.data,
      'research.proposed',
      proposal.ok ? 'succeeded' : 'failed',
    );
  } catch {
    if (proposal.ok) return { ok: false, error: 'proposalFailed' };
  }
  return proposal;
}

export async function reviewOrganizationResearchFact(
  deps: ResearchServiceDeps,
  kindInput: unknown,
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: ResearchErrorCode }> {
  const resolved = await resolveOrganizationAccess(deps, kindInput);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const decision = reviewDecisionSchema.safeParse(input);
  if (!decision.success) return { ok: false, error: 'invalidInput' };

  try {
    await reviewResearchFact(
      deps.db,
      resolved.access.organizationId,
      resolved.access.actorClerkUserId,
      decision.data,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'staleResearchState') {
      return { ok: false, error: 'staleResearchState' };
    }
    return { ok: false, error: 'notFound' };
  }

  try {
    await recordDataControlEvent(deps.db, {
      organizationId: resolved.access.organizationId,
      actorClerkUserId: resolved.access.actorClerkUserId,
      action: 'research.reviewed',
      targetType: 'research_fact',
      targetId: decision.data.factId,
      outcome: 'succeeded',
    });
  } catch {
    return { ok: false, error: 'proposalFailed' };
  }
  return { ok: true };
}

export async function getCurrentOrganizationResearch(
  deps: ResearchServiceDeps,
  kindInput: unknown,
): Promise<OrganizationResearchDTO | null> {
  const kind = secretaryContextKindSchema.safeParse(kindInput);
  if (!kind.success) return null;

  const resolved = await resolveOrganizationAccess(deps, kind.data);
  if (!resolved.ok) {
    return kind.data === 'personal' ? null : { available: false, facts: [] };
  }
  if (availabilityError()) return { available: false, facts: [] };

  try {
    return await getLatestOrganizationResearchDTO(deps.db, resolved.access.organizationId);
  } catch {
    return { available: false, facts: [] };
  }
}
