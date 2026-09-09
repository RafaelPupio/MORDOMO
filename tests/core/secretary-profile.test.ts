import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECRETARY_PROFILES,
  approvedPublicFactSchema,
  parseSecretaryProfile,
} from '@/core/secretary-profile';

describe('secretary profiles', () => {
  it('rejects credentials and private free text from the persisted profile shape', () => {
    expect(() => parseSecretaryProfile({
      assistantName: 'Mia',
      defaultLocale: 'pt',
      replyTone: 'warm',
      greeting: 'Olá!',
      escalationCopy: 'Vou encaminhar.',
      enabledCapabilities: ['knowledge', 'escalation'],
      segment: 'personal',
      password: 'not-allowed',
      privateNotes: 'not-allowed',
    })).toThrow();
  });

  it('uses a Personal Secretary Portuguese default without private fields', () => {
    const profile = parseSecretaryProfile(DEFAULT_SECRETARY_PROFILES.personal);

    expect(profile).toMatchObject({ segment: 'personal', defaultLocale: 'pt' });
    expect(profile).not.toHaveProperty('notes');
  });

  it('defaults stored pre-research profile JSON to an empty approved fact list', () => {
    const profile = parseSecretaryProfile({
      segment: 'church',
      defaultLocale: 'en',
      assistantName: 'Avery',
      replyTone: 'professional',
      greeting: 'Welcome.',
      escalationCopy: 'A team member will follow up.',
      enabledCapabilities: ['knowledge', 'escalation'],
    });

    expect(profile.approvedPublicFacts).toEqual([]);
  });

  it('keeps approved public snapshots strict and bounded', () => {
    const valid = {
      researchFactId: '11111111-1111-4111-8111-111111111111',
      sourceId: '22222222-2222-4222-8222-222222222222',
      text: 'Open Monday.',
      sourceTitle: 'Fictional Clinic',
      sourceUrl: 'https://example.com/about',
    };

    expect(approvedPublicFactSchema.parse(valid)).toEqual(valid);
    expect(() => approvedPublicFactSchema.parse({ ...valid, text: 'x'.repeat(281) })).toThrow();
    expect(() => approvedPublicFactSchema.parse({ ...valid, sourceTitle: 'x'.repeat(201) })).toThrow();
    expect(() => approvedPublicFactSchema.parse({ ...valid, providerSessionId: 'forbidden' })).toThrow();
    expect(() => parseSecretaryProfile({
      ...DEFAULT_SECRETARY_PROFILES.organization,
      approvedPublicFacts: Array.from({ length: 13 }, () => valid),
    })).toThrow();
  });
});
