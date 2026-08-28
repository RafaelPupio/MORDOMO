import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECRETARY_PROFILES,
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
});
