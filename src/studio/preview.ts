import type { SecretaryProfile } from '@/core/secretary-profile';
import type { StudioScenario, StudioScenarioResult } from '@/studio/scenarios';

export type StudioPreview = {
  greeting: string;
  assistantName: string;
  tone: SecretaryProfile['replyTone'];
  result: StudioScenarioResult;
};

export function buildStudioPreview(
  profile: SecretaryProfile,
  scenario: StudioScenario,
): StudioPreview {
  const result = profile.enabledCapabilities.includes(scenario.result.requiredCapability)
    ? scenario.result
    : {
      kind: 'escalation' as const,
      text: profile.escalationCopy,
      requiredCapability: 'escalation' as const,
    };

  return {
    greeting: profile.greeting,
    assistantName: profile.assistantName,
    tone: profile.replyTone,
    result,
  };
}
