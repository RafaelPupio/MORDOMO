import { describe, expect, it } from 'vitest';
import { parseOrganizationProfile } from '@/core/organization-profile';

describe('organization profiles', () => {
  it('fills the church-safe defaults while accepting a supported locale and capability set', () => {
    const profile = parseOrganizationProfile({
      defaultLocale: 'fr',
      enabledCapabilities: ['knowledge', 'escalation'],
    });

    expect(profile).toMatchObject({
      industry: 'church',
      defaultLocale: 'fr',
      assistantName: 'Secretária',
      replyTone: 'warm',
      enabledCapabilities: ['knowledge', 'escalation'],
    });
  });

  it('rejects an unsupported locale before it can be persisted', () => {
    expect(() => parseOrganizationProfile({ defaultLocale: 'xx' })).toThrow();
  });

  it('rejects an unsupported capability before it can reach a secretary prompt', () => {
    expect(() => parseOrganizationProfile({ enabledCapabilities: ['knowledge', 'booking'] })).toThrow();
  });
});
