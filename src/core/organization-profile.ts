import { z } from 'zod';

export const localeSchema = z.enum(['en', 'pt', 'es', 'fr', 'de']);
export const industrySchema = z.enum(['church', 'clinic', 'restaurant', 'real_estate', 'general']);
export const replyToneSchema = z.enum(['warm', 'professional', 'concise']);
export const capabilitySchema = z.enum([
  'knowledge',
  'calendar',
  'confidential_request',
  'escalation',
]);

export const organizationProfileSchema = z.object({
  industry: industrySchema,
  defaultLocale: localeSchema,
  assistantName: z.string().trim().min(1).max(80),
  replyTone: replyToneSchema,
  greeting: z.string().trim().max(280),
  escalationCopy: z.string().trim().max(280),
  enabledCapabilities: z.array(capabilitySchema).min(2).max(4),
});

export type Locale = z.infer<typeof localeSchema>;
export type Industry = z.infer<typeof industrySchema>;
export type ReplyTone = z.infer<typeof replyToneSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type OrganizationProfile = z.infer<typeof organizationProfileSchema>;

export const DEFAULT_ORGANIZATION_PROFILE: OrganizationProfile = {
  industry: 'church',
  defaultLocale: 'pt',
  assistantName: 'Secretária',
  replyTone: 'warm',
  greeting: 'Olá! Como posso ajudar?',
  escalationCopy: 'Vou encaminhar sua mensagem para a equipe responsável.',
  enabledCapabilities: ['knowledge', 'calendar', 'confidential_request', 'escalation'],
};

const profilePatchSchema = organizationProfileSchema.partial();

export function parseOrganizationProfile(input: unknown): OrganizationProfile {
  return organizationProfileSchema.parse({
    ...DEFAULT_ORGANIZATION_PROFILE,
    ...profilePatchSchema.parse(input),
  });
}
