import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { SecretaryProfile } from '@/core/secretary-profile';
import { buildStudioPreview } from '@/studio/preview';
import { STUDIO_SCENARIOS } from '@/studio/scenarios';

const profile: SecretaryProfile = {
  segment: 'church',
  defaultLocale: 'en',
  assistantName: 'Avery',
  replyTone: 'professional',
  greeting: 'Welcome to the fictional demo.',
  escalationCopy: 'A fictional team member will review this request.',
  enabledCapabilities: ['knowledge', 'calendar', 'confidential_request', 'escalation'],
};

describe('buildStudioPreview', () => {
  it('uses only the editable display fields and the scenario result', () => {
    expect(buildStudioPreview(profile, STUDIO_SCENARIOS.en.church)).toEqual({
      greeting: 'Welcome to the fictional demo.',
      assistantName: 'Avery',
      tone: 'professional',
      result: STUDIO_SCENARIOS.en.church.result,
    });
  });

  it('escalates instead of promising a disabled capability', () => {
    const withoutCalendar: SecretaryProfile = {
      ...profile,
      enabledCapabilities: ['knowledge', 'confidential_request', 'escalation'],
    };

    const result = buildStudioPreview(withoutCalendar, STUDIO_SCENARIOS.en.restaurant);

    expect(result.result).toEqual({
      kind: 'escalation',
      text: 'A fictional team member will review this request.',
      requiredCapability: 'escalation',
    });
    expect(result.result.citation).toBeUndefined();
  });

  it('does not import AI SDK or usage modules', async () => {
    const previewSource = await readFile('src/studio/preview.ts', 'utf8');

    expect(previewSource).not.toMatch(/from ['\"](?:ai|@\/ai\/usage|@\/agent\/)/);
  });
});
