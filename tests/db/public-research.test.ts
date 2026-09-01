import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  beginProposalAttempt,
  createResearchBrief,
  failResearchBrief,
  getLatestOrganizationResearchDTO,
  listAcceptedResearchFacts,
  markResearchApplied,
  recordDataControlEvent,
  reviewResearchFact,
  saveProposedFacts,
  saveResearchSource,
} from '@/db/repo/public-research';
import {
  dataControlEvents,
  researchBriefs,
  researchFacts,
} from '@/db/schema';
import type { Db } from '@/db/client';
import { RESEARCH_CONSENT_VERSION } from '@/research/contracts';
import { createTestDb, seedOrganization } from '../helpers/db';

async function newBrief(db: Db, organizationId: string, suffix = 'one') {
  return createResearchBrief(db, {
    organizationId,
    requestedByClerkUserId: `user_${suffix}`,
    segment: 'church',
    city: 'Cuiabá',
    locale: 'pt',
    requestedUrl: `https://${suffix}.example.org/`,
    consentVersion: RESEARCH_CONSENT_VERSION,
    now: new Date('2026-09-01T12:00:00Z'),
  });
}

async function sourceReady(db: Db, organizationId: string, suffix = 'one') {
  const brief = await newBrief(db, organizationId, suffix);
  const source = await saveResearchSource(db, organizationId, brief.id, {
    url: `https://${suffix}.example.org/`,
    title: `Example ${suffix}`,
    excerpt: 'Open Monday. Community dinner Friday.',
    retrievedAt: new Date('2026-09-01T12:01:00Z'),
  });
  return { brief, source };
}

describe('public research repository', () => {
  it('enforces tenant scope through the complete review and apply state machine', async () => {
    const db = await createTestDb();
    const organizationA = await seedOrganization(db, 'Organization A');
    const organizationB = await seedOrganization(db, 'Organization B');
    const actorA = 'user_a';
    const actorB = 'user_b';
    const briefA = await newBrief(db, organizationA.id);

    await expect(saveResearchSource(db, organizationB.id, briefA.id, {
      url: 'https://one.example.org/',
      title: 'Forged source',
      excerpt: 'Forged excerpt',
    })).rejects.toThrow('Research brief not found.');

    const sourceA = await saveResearchSource(db, organizationA.id, briefA.id, {
      url: 'https://one.example.org/',
      title: 'Example Organization',
      excerpt: 'Open Monday. Community dinner Friday.',
    });

    await expect(beginProposalAttempt(db, organizationB.id, briefA.id))
      .rejects.toThrow('Research brief not found.');
    const attempt = await beginProposalAttempt(db, organizationA.id, briefA.id);
    expect(attempt.brief).toMatchObject({ status: 'proposing', proposalAttempts: 1 });
    expect(attempt.source.id).toBe(sourceA.id);

    await saveProposedFacts(db, organizationA.id, briefA.id, sourceA.id, [
      { proposedText: 'Open Monday.', supportingQuote: 'Open Monday.' },
      { proposedText: 'Community dinner is Friday.', supportingQuote: 'Community dinner Friday.' },
    ]);

    const facts = await db
      .select()
      .from(researchFacts)
      .where(and(
        eq(researchFacts.organizationId, organizationA.id),
        eq(researchFacts.briefId, briefA.id),
      ));
    expect(facts).toHaveLength(2);

    const dto = await getLatestOrganizationResearchDTO(db, organizationA.id);
    expect(dto).toEqual({
      available: true,
      briefId: briefA.id,
      status: 'review_ready',
      source: { title: 'Example Organization', url: 'https://one.example.org/' },
      facts: expect.arrayContaining([
        expect.objectContaining({ proposedText: 'Open Monday.', reviewStatus: 'proposed' }),
        expect.objectContaining({ proposedText: 'Community dinner is Friday.', reviewStatus: 'proposed' }),
      ]),
    });
    expect(JSON.stringify(dto)).not.toContain('excerpt');
    expect(JSON.stringify(dto)).not.toContain(actorA);
    expect(JSON.stringify(dto)).not.toContain(RESEARCH_CONSENT_VERSION);

    const monday = facts.find((fact) => fact.proposedText === 'Open Monday.')!;
    const dinner = facts.find((fact) => fact.proposedText.startsWith('Community'))!;
    const accept = { factId: monday.id, decision: 'accept' as const, acceptedText: 'Open every Monday.' };

    await expect(reviewResearchFact(db, organizationB.id, actorB, {
      ...accept,
      acceptedText: 'Forged edit',
    })).rejects.toThrow('Research fact not found.');

    const accepted = await reviewResearchFact(db, organizationA.id, actorA, accept);
    expect(accepted).toMatchObject({
      id: monday.id,
      proposedText: 'Open Monday.',
      supportingQuote: 'Open Monday.',
      reviewStatus: 'accepted',
      acceptedText: 'Open every Monday.',
    });
    expect(await reviewResearchFact(db, organizationA.id, actorA, accept)).toEqual(accepted);
    await expect(reviewResearchFact(db, organizationA.id, actorA, {
      ...accept,
      acceptedText: 'A conflicting stale edit.',
    })).rejects.toThrow('staleResearchState');

    await expect(markResearchApplied(db, organizationA.id, briefA.id))
      .rejects.toThrow('Research brief is not ready to apply.');
    await reviewResearchFact(db, organizationA.id, actorA, { factId: dinner.id, decision: 'reject' });
    const applied = await markResearchApplied(db, organizationA.id, briefA.id);
    expect(applied.status).toBe('applied');

    const acceptedFacts = await listAcceptedResearchFacts(db, organizationA.id, [monday.id, dinner.id]);
    expect(acceptedFacts).toEqual([expect.objectContaining({
      researchFactId: monday.id,
      sourceId: sourceA.id,
      text: 'Open every Monday.',
      sourceTitle: 'Example Organization',
      sourceUrl: 'https://one.example.org/',
    })]);
    expect(await listAcceptedResearchFacts(db, organizationB.id, [monday.id])).toEqual([]);
  });

  it('retries a failed proposal from its stored source but never exceeds three attempts', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);
    const { brief } = await sourceReady(db, organization.id, 'retry');

    for (const attemptNumber of [1, 2, 3]) {
      const attempt = await beginProposalAttempt(db, organization.id, brief.id);
      expect(attempt.brief.proposalAttempts).toBe(attemptNumber);
      await failResearchBrief(db, organization.id, brief.id, 'proposalFailed');
    }

    await expect(beginProposalAttempt(db, organization.id, brief.id))
      .rejects.toThrow('Research brief is not retryable.');
  });

  it('moves an empty grounded result through review-ready to applied', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);
    const { brief, source } = await sourceReady(db, organization.id, 'empty');

    await beginProposalAttempt(db, organization.id, brief.id);
    await saveProposedFacts(db, organization.id, brief.id, source.id, []);
    const applied = await markResearchApplied(db, organization.id, brief.id);

    expect(applied.status).toBe('applied');
  });

  it('rejects stale transitions and more than twelve proposed facts', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);
    const { brief, source } = await sourceReady(db, organization.id, 'bounded');

    await expect(saveResearchSource(db, organization.id, brief.id, {
      url: source.url,
      title: source.title,
      excerpt: source.excerpt,
    })).rejects.toThrow('Research brief not found.');
    await beginProposalAttempt(db, organization.id, brief.id);
    await expect(saveProposedFacts(db, organization.id, brief.id, source.id,
      Array.from({ length: 13 }, (_, index) => ({
        proposedText: `Fact ${index}`,
        supportingQuote: 'Open Monday.',
      }))))
      .rejects.toThrow('Too many research facts.');
  });

  it('records only the finite metadata audit contract', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);

    const saved = await recordDataControlEvent(db, {
      organizationId: organization.id,
      actorClerkUserId: 'user_a',
      action: 'research.started',
      targetType: 'research_brief',
      targetId: crypto.randomUUID(),
      outcome: 'succeeded',
    });
    const [stored] = await db
      .select()
      .from(dataControlEvents)
      .where(eq(dataControlEvents.id, saved.id));

    expect(Object.keys(stored).sort()).toEqual([
      'action',
      'actorClerkUserId',
      'createdAt',
      'id',
      'organizationId',
      'outcome',
      'targetId',
      'targetType',
    ]);
    expect(JSON.stringify(stored)).not.toMatch(/url|excerpt|content|prompt|error/i);
  });

  it('returns an empty safe DTO when the Organization has no research', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);

    expect(await getLatestOrganizationResearchDTO(db, organization.id)).toEqual({
      available: true,
      facts: [],
    });
    expect(await db.select().from(researchBriefs)).toEqual([]);
  });
});
