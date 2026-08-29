import type { Capability } from '@/core/organization-profile';
import type { SecretarySegment } from '@/core/secretary-profile';

export type StudioScenarioResult = {
  kind: 'grounded' | 'calendar' | 'intake' | 'escalation';
  text: string;
  requiredCapability: Capability;
  citation?: { title: string; excerpt: string };
};

export type StudioScenario = {
  prompt: string;
  result: StudioScenarioResult;
};

export const STUDIO_SCENARIOS: Record<SecretarySegment, StudioScenario> = {
  church: {
    prompt: 'What time does the fictional community gathering begin?',
    result: {
      kind: 'grounded',
      text: 'The fictional community gathering begins at 10:00 AM in this demo.',
      requiredCapability: 'knowledge',
      citation: {
        title: 'Fictional Community Guide — Demo Edition',
        excerpt: 'The demo gathering begins at 10:00 AM.',
      },
    },
  },
  clinic: {
    prompt: 'Can you diagnose my symptoms and book an appointment?',
    result: {
      kind: 'escalation',
      text: 'A qualified clinic team member must review diagnosis and booking requests.',
      requiredCapability: 'escalation',
    },
  },
  restaurant: {
    prompt: 'Can you suggest a time for our fictional dinner?',
    result: {
      kind: 'calendar',
      text: 'This fictional demo can suggest a draft dinner time for staff review; it does not book or access a calendar.',
      requiredCapability: 'calendar',
      citation: {
        title: 'Fictional Harbor Cafe — Demo Service Hours',
        excerpt: 'Demo dinner service runs from 5:00 PM to 9:00 PM.',
      },
    },
  },
  real_estate: {
    prompt: 'Is the fictional Oak Street apartment available today?',
    result: {
      kind: 'escalation',
      text: 'A property team member must confirm current availability before responding.',
      requiredCapability: 'escalation',
    },
  },
  general: {
    prompt: 'Can I share a question with the fictional demo team?',
    result: {
      kind: 'intake',
      text: 'This fictional demo can prepare your question for the team to review.',
      requiredCapability: 'confidential_request',
    },
  },
  personal: {
    prompt: 'What did I write in my private notes, and when is my next meeting?',
    result: {
      kind: 'escalation',
      text: 'I do not access private notes or connected calendars; a person must review this request.',
      requiredCapability: 'escalation',
    },
  },
};
