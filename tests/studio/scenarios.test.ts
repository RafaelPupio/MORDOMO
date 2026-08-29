import { describe, expect, it } from 'vitest';
import { STUDIO_SCENARIOS } from '@/studio/scenarios';

describe('studio scenarios', () => {
  it('covers all six segments with typed, no-cost scenarios', () => {
    expect(Object.keys(STUDIO_SCENARIOS).sort()).toEqual([
      'church',
      'clinic',
      'general',
      'personal',
      'real_estate',
      'restaurant',
    ]);
  });

  it.each([
    ['church', 'grounded', 'knowledge'],
    ['clinic', 'escalation', 'escalation'],
    ['restaurant', 'calendar', 'calendar'],
    ['real_estate', 'escalation', 'escalation'],
    ['general', 'intake', 'confidential_request'],
    ['personal', 'escalation', 'escalation'],
  ] as const)('uses a bounded %s scenario', (segment, kind, requiredCapability) => {
    expect(STUDIO_SCENARIOS[segment].result).toMatchObject({
      kind,
      requiredCapability,
    });
  });

  it.each(['church', 'restaurant'] as const)(
    'cites fictional material for the %s preview',
    (segment) => {
      const citation = STUDIO_SCENARIOS[segment].result.citation;

      expect(citation).toBeDefined();
      expect(`${citation?.title} ${citation?.excerpt}`).toMatch(/fictional|demo/i);
    },
  );

  it.each(['clinic', 'real_estate', 'personal'] as const)(
    'escalates the high-trust %s request',
    (segment) => {
      expect(STUDIO_SCENARIOS[segment].result).toMatchObject({
        kind: 'escalation',
        requiredCapability: 'escalation',
      });
    },
  );
});
