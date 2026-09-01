import { z } from 'zod';
import { betaLocaleSchema } from '@/core/secretary-profile';

export const RESEARCH_CONSENT_VERSION = 'public-research-v2' as const;
export const MAX_RESEARCH_FACTS = 12;

export const organizationResearchSegmentSchema = z.enum([
  'church',
  'clinic',
  'restaurant',
  'real_estate',
  'general',
]);

export const researchStatusSchema = z.enum([
  'retrieving',
  'source_ready',
  'proposing',
  'review_ready',
  'failed',
  'applied',
]);
export type ResearchStatus = z.infer<typeof researchStatusSchema>;

export const researchErrorCodeSchema = z.enum([
  'researchUnavailable',
  'forbidden',
  'invalidInput',
  'unsafeUrl',
  'rateLimited',
  'budgetExhausted',
  'providerUnavailable',
  'retentionUnverified',
  'noUsefulContent',
  'proposalFailed',
  'ungroundedProposal',
  'staleResearchState',
  'notFound',
]);
export type ResearchErrorCode = z.infer<typeof researchErrorCodeSchema>;

export const publicResearchInputSchema = z.object({
  url: z.string().trim().min(1).max(2_048),
  city: z.string().trim().max(120).optional().transform((value) => value || undefined),
  locale: betaLocaleSchema,
  segment: organizationResearchSegmentSchema,
  consentVersion: z.literal(RESEARCH_CONSENT_VERSION),
  consent: z.literal('on'),
}).strict();

export const reviewDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('accept'),
    factId: z.uuid(),
    acceptedText: z.string().trim().min(1).max(280),
  }).strict(),
  z.object({
    decision: z.literal('reject'),
    factId: z.uuid(),
  }).strict(),
]);

export type ResearchFactDTO = {
  id: string;
  proposedText: string;
  supportingQuote: string;
  reviewStatus: 'proposed' | 'accepted' | 'rejected';
  acceptedText?: string;
};

export type OrganizationResearchDTO = {
  available: boolean;
  briefId?: string;
  status?: ResearchStatus;
  error?: ResearchErrorCode;
  source?: { title: string; url: string };
  facts: ResearchFactDTO[];
};
