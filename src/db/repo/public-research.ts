import {
  and,
  desc,
  eq,
  exists,
  inArray,
  lt,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import type { BetaLocale, SecretarySegment } from '@/core/secretary-profile';
import type { Db } from '@/db/client';
import {
  dataControlEvents,
  researchBriefs,
  researchFacts,
  researchSources,
} from '@/db/schema';
import {
  MAX_RESEARCH_FACTS,
  RESEARCH_CONSENT_VERSION,
  researchErrorCodeSchema,
  researchStatusSchema,
  type OrganizationResearchDTO,
  type ResearchErrorCode,
  type ResearchFactDTO,
} from '@/research/contracts';

export type ResearchBrief = typeof researchBriefs.$inferSelect;
export type ResearchSource = typeof researchSources.$inferSelect;
export type ResearchFact = typeof researchFacts.$inferSelect;

type ReviewResearchFactInput =
  | { factId: string; decision: 'accept'; acceptedText: string }
  | { factId: string; decision: 'reject' };

export type AcceptedResearchFact = {
  researchFactId: string;
  sourceId: string;
  text: string;
  sourceTitle: string;
  sourceUrl: string;
};

export type DataControlEventInput = {
  organizationId: string;
  actorClerkUserId: string;
  action: 'research.started' | 'research.source' | 'research.proposed' | 'research.reviewed' | 'research.applied';
  targetType: 'research_brief' | 'research_fact' | 'profile_version';
  targetId: string;
  outcome: 'succeeded' | 'failed';
};

function safeFact(row: ResearchFact): ResearchFactDTO {
  return {
    id: row.id,
    proposedText: row.proposedText,
    supportingQuote: row.supportingQuote,
    reviewStatus: row.reviewStatus as ResearchFactDTO['reviewStatus'],
    ...(row.acceptedText === null ? {} : { acceptedText: row.acceptedText }),
  };
}

export async function createResearchBrief(db: Db, input: {
  organizationId: string;
  requestedByClerkUserId: string;
  segment: Exclude<SecretarySegment, 'personal'>;
  city?: string;
  locale: BetaLocale;
  requestedUrl: string;
  consentVersion: typeof RESEARCH_CONSENT_VERSION;
  now?: Date;
}): Promise<ResearchBrief> {
  const now = input.now ?? new Date();
  const [brief] = await db
    .insert(researchBriefs)
    .values({
      organizationId: input.organizationId,
      requestedByClerkUserId: input.requestedByClerkUserId,
      segment: input.segment,
      city: input.city,
      locale: input.locale,
      requestedUrl: input.requestedUrl,
      consentVersion: input.consentVersion,
      consentedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!brief) throw new Error('Research brief was not created.');
  return brief;
}

export async function saveResearchSource(
  db: Db,
  organizationId: string,
  briefId: string,
  input: { url: string; title: string; excerpt: string; retrievedAt?: Date },
): Promise<ResearchSource> {
  const [brief] = await db
    .select({ id: researchBriefs.id })
    .from(researchBriefs)
    .where(and(
      eq(researchBriefs.organizationId, organizationId),
      eq(researchBriefs.id, briefId),
      eq(researchBriefs.status, 'retrieving'),
    ));
  if (!brief) throw new Error('Research brief not found.');

  const retrievedAt = input.retrievedAt ?? new Date();
  const [source] = await db
    .insert(researchSources)
    .values({ organizationId, briefId, ...input, retrievedAt })
    .returning();
  if (!source) throw new Error('Research source was not saved.');

  const [transitioned] = await db
    .update(researchBriefs)
    .set({ status: 'source_ready', errorCode: null, updatedAt: retrievedAt })
    .where(and(
      eq(researchBriefs.organizationId, organizationId),
      eq(researchBriefs.id, briefId),
      eq(researchBriefs.status, 'retrieving'),
    ))
    .returning({ id: researchBriefs.id });
  if (!transitioned) throw new Error('Research brief is not ready for a source.');

  return source;
}

export async function beginProposalAttempt(
  db: Db,
  organizationId: string,
  briefId: string,
): Promise<{ brief: ResearchBrief; source: ResearchSource }> {
  const [ownedBrief] = await db
    .select({ id: researchBriefs.id })
    .from(researchBriefs)
    .where(and(
      eq(researchBriefs.organizationId, organizationId),
      eq(researchBriefs.id, briefId),
    ));
  if (!ownedBrief) throw new Error('Research brief not found.');

  const sourceExists = db
    .select({ id: researchSources.id })
    .from(researchSources)
    .where(and(
      eq(researchSources.organizationId, organizationId),
      eq(researchSources.briefId, briefId),
    ));
  const now = new Date();
  const [brief] = await db
    .update(researchBriefs)
    .set({
      status: 'proposing',
      errorCode: null,
      proposalAttempts: sql`${researchBriefs.proposalAttempts} + 1`,
      updatedAt: now,
    })
    .where(and(
      eq(researchBriefs.organizationId, organizationId),
      eq(researchBriefs.id, briefId),
      or(eq(researchBriefs.status, 'source_ready'), eq(researchBriefs.status, 'failed')),
      lt(researchBriefs.proposalAttempts, 3),
      exists(sourceExists),
    ))
    .returning();
  if (!brief) throw new Error('Research brief is not retryable.');

  const [source] = await db
    .select()
    .from(researchSources)
    .where(and(
      eq(researchSources.organizationId, organizationId),
      eq(researchSources.briefId, briefId),
    ));
  if (!source) throw new Error('Research source not found.');

  return { brief, source };
}

export async function saveProposedFacts(
  db: Db,
  organizationId: string,
  briefId: string,
  sourceId: string,
  facts: Array<{ proposedText: string; supportingQuote: string }>,
): Promise<void> {
  if (facts.length > MAX_RESEARCH_FACTS) throw new Error('Too many research facts.');

  const [brief] = await db
    .select({ id: researchBriefs.id })
    .from(researchBriefs)
    .where(and(
      eq(researchBriefs.organizationId, organizationId),
      eq(researchBriefs.id, briefId),
      eq(researchBriefs.status, 'proposing'),
    ));
  const [source] = await db
    .select({ id: researchSources.id })
    .from(researchSources)
    .where(and(
      eq(researchSources.organizationId, organizationId),
      eq(researchSources.briefId, briefId),
      eq(researchSources.id, sourceId),
    ));
  if (!brief || !source) throw new Error('Research proposal target not found.');

  if (facts.length > 0) {
    await db.insert(researchFacts).values(facts.map((fact) => ({
      organizationId,
      briefId,
      sourceId,
      ...fact,
    })));
  }

  const [transitioned] = await db
    .update(researchBriefs)
    .set({ status: 'review_ready', errorCode: null, updatedAt: new Date() })
    .where(and(
      eq(researchBriefs.organizationId, organizationId),
      eq(researchBriefs.id, briefId),
      eq(researchBriefs.status, 'proposing'),
    ))
    .returning({ id: researchBriefs.id });
  if (!transitioned) throw new Error('Research brief is not ready for proposals.');
}

export async function failResearchBrief(
  db: Db,
  organizationId: string,
  briefId: string,
  errorCode: ResearchErrorCode,
): Promise<ResearchBrief> {
  const safeError = researchErrorCodeSchema.parse(errorCode);
  const [failed] = await db
    .update(researchBriefs)
    .set({ status: 'failed', errorCode: safeError, updatedAt: new Date() })
    .where(and(
      eq(researchBriefs.organizationId, organizationId),
      eq(researchBriefs.id, briefId),
      inArray(researchBriefs.status, ['retrieving', 'source_ready', 'proposing']),
    ))
    .returning();
  if (!failed) throw new Error('Research brief not found.');
  return failed;
}

export async function getLatestOrganizationResearchDTO(
  db: Db,
  organizationId: string,
): Promise<OrganizationResearchDTO> {
  const [brief] = await db
    .select()
    .from(researchBriefs)
    .where(eq(researchBriefs.organizationId, organizationId))
    .orderBy(desc(researchBriefs.createdAt), desc(researchBriefs.id))
    .limit(1);
  if (!brief) return { available: true, facts: [] };

  const [source] = await db
    .select({ title: researchSources.title, url: researchSources.url })
    .from(researchSources)
    .where(and(
      eq(researchSources.organizationId, organizationId),
      eq(researchSources.briefId, brief.id),
    ));
  const facts = await db
    .select()
    .from(researchFacts)
    .where(and(
      eq(researchFacts.organizationId, organizationId),
      eq(researchFacts.briefId, brief.id),
    ))
    .orderBy(researchFacts.createdAt, researchFacts.id);

  return {
    available: true,
    briefId: brief.id,
    status: researchStatusSchema.parse(brief.status),
    ...(brief.errorCode === null ? {} : { error: researchErrorCodeSchema.parse(brief.errorCode) }),
    ...(source ? { source } : {}),
    facts: facts.map(safeFact),
  };
}

export async function reviewResearchFact(
  db: Db,
  organizationId: string,
  actorClerkUserId: string,
  input: ReviewResearchFactInput,
): Promise<ResearchFactDTO> {
  const reviewedAt = new Date();
  const [updated] = await db
    .update(researchFacts)
    .set(input.decision === 'accept'
      ? {
          reviewStatus: 'accepted',
          acceptedText: input.acceptedText,
          reviewedByClerkUserId: actorClerkUserId,
          reviewedAt,
        }
      : {
          reviewStatus: 'rejected',
          acceptedText: null,
          reviewedByClerkUserId: actorClerkUserId,
          reviewedAt,
        })
    .where(and(
      eq(researchFacts.organizationId, organizationId),
      eq(researchFacts.id, input.factId),
      eq(researchFacts.reviewStatus, 'proposed'),
    ))
    .returning();
  if (updated) return safeFact(updated);

  const [existing] = await db
    .select()
    .from(researchFacts)
    .where(and(
      eq(researchFacts.organizationId, organizationId),
      eq(researchFacts.id, input.factId),
    ));
  if (!existing) throw new Error('Research fact not found.');

  const identical = input.decision === 'accept'
    ? existing.reviewStatus === 'accepted' && existing.acceptedText === input.acceptedText
    : existing.reviewStatus === 'rejected';
  if (!identical) throw new Error('staleResearchState');
  return safeFact(existing);
}

export async function listAcceptedResearchFacts(
  db: Db,
  organizationId: string,
  factIds: string[],
): Promise<AcceptedResearchFact[]> {
  const orderedIds = [...new Set(factIds)].slice(0, MAX_RESEARCH_FACTS);
  if (orderedIds.length === 0) return [];

  const rows = await db
    .select({
      researchFactId: researchFacts.id,
      sourceId: researchSources.id,
      text: researchFacts.acceptedText,
      sourceTitle: researchSources.title,
      sourceUrl: researchSources.url,
    })
    .from(researchFacts)
    .innerJoin(researchSources, and(
      eq(researchSources.organizationId, organizationId),
      eq(researchSources.id, researchFacts.sourceId),
    ))
    .where(and(
      eq(researchFacts.organizationId, organizationId),
      eq(researchFacts.reviewStatus, 'accepted'),
      inArray(researchFacts.id, orderedIds),
    ));
  const byId = new Map(rows
    .filter((row): row is AcceptedResearchFact => row.text !== null)
    .map((row) => [row.researchFactId, row]));
  return orderedIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

export async function markResearchApplied(
  db: Db,
  organizationId: string,
  briefId: string,
): Promise<ResearchBrief> {
  const proposedFacts = db
    .select({ id: researchFacts.id })
    .from(researchFacts)
    .where(and(
      eq(researchFacts.organizationId, organizationId),
      eq(researchFacts.briefId, briefId),
      eq(researchFacts.reviewStatus, 'proposed'),
    ));
  const [applied] = await db
    .update(researchBriefs)
    .set({ status: 'applied', errorCode: null, updatedAt: new Date() })
    .where(and(
      eq(researchBriefs.organizationId, organizationId),
      eq(researchBriefs.id, briefId),
      eq(researchBriefs.status, 'review_ready'),
      notExists(proposedFacts),
    ))
    .returning();
  if (!applied) throw new Error('Research brief is not ready to apply.');
  return applied;
}

export async function recordDataControlEvent(db: Db, input: DataControlEventInput) {
  const [event] = await db.insert(dataControlEvents).values(input).returning();
  if (!event) throw new Error('Data control event was not recorded.');
  return event;
}
