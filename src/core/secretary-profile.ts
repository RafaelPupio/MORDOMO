import { z } from 'zod';
import {
  capabilitySchema,
  replyToneSchema,
  type Industry,
} from '@/core/organization-profile';

export const betaLocaleSchema = z.enum(['en', 'pt']);
export const secretaryContextKindSchema = z.enum(['organization', 'personal']);
export const secretarySegmentSchema = z.enum([
  'church',
  'clinic',
  'restaurant',
  'real_estate',
  'general',
  'personal',
]);

export type BetaLocale = z.infer<typeof betaLocaleSchema>;
export type SecretaryContextKind = z.infer<typeof secretaryContextKindSchema>;
export type SecretarySegment = Industry | 'personal';

export const approvedPublicFactSchema = z.object({
  researchFactId: z.uuid(),
  sourceId: z.uuid(),
  text: z.string().trim().min(1).max(280),
  sourceTitle: z.string().trim().min(1).max(200),
  sourceUrl: z.string().url().max(2048),
}).strict();

export type ApprovedPublicFact = z.infer<typeof approvedPublicFactSchema>;

export const secretaryProfileSchema = z.object({
  segment: secretarySegmentSchema,
  defaultLocale: betaLocaleSchema,
  assistantName: z.string().trim().min(1).max(80),
  replyTone: replyToneSchema,
  greeting: z.string().trim().min(1).max(280),
  escalationCopy: z.string().trim().min(1).max(280),
  enabledCapabilities: z.array(capabilitySchema).min(2).max(4),
  approvedPublicFacts: z.array(approvedPublicFactSchema).max(12).default([]),
}).strict();

export type SecretaryProfile = z.infer<typeof secretaryProfileSchema>;

export function parseSecretaryProfile(input: unknown): SecretaryProfile {
  return secretaryProfileSchema.parse(input);
}

export const DEFAULT_SECRETARY_PROFILES: Record<SecretaryContextKind, SecretaryProfile> = {
  organization: {
    segment: 'church',
    defaultLocale: 'pt',
    assistantName: 'Secretária',
    replyTone: 'warm',
    greeting: 'Olá! Como posso ajudar?',
    escalationCopy: 'Vou encaminhar sua mensagem para a equipe responsável.',
    enabledCapabilities: ['knowledge', 'calendar', 'escalation'],
    approvedPublicFacts: [],
  },
  personal: {
    segment: 'personal',
    defaultLocale: 'pt',
    assistantName: 'Mia',
    replyTone: 'warm',
    greeting: 'Olá! Como posso ajudar você hoje?',
    escalationCopy: 'Não tenho segurança para fazer isso. Posso ajudar com outra coisa?',
    enabledCapabilities: ['knowledge', 'escalation'],
    approvedPublicFacts: [],
  },
};
