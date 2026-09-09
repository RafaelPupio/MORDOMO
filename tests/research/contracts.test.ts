import { describe, expect, it } from 'vitest';
import {
  publicResearchInputSchema,
  researchErrorCodeSchema,
  researchStatusSchema,
  reviewDecisionSchema,
} from '@/research/contracts';

const validInput = {
  url: 'https://example.com/about',
  city: '  Fictional City  ',
  locale: 'en',
  segment: 'clinic',
  consentVersion: 'public-research-v2',
  consent: 'on',
} as const;

describe('public research input contract', () => {
  it.each(['en', 'pt'] as const)('accepts the approved Organization input in %s', (locale) => {
    expect(publicResearchInputSchema.parse({ ...validInput, locale })).toEqual({
      ...validInput,
      locale,
      city: 'Fictional City',
    });
  });

  it('rejects the never-activated provider consent and missing consent', () => {
    expect(() => publicResearchInputSchema.parse({
      ...validInput,
      consentVersion: 'public-research-v1',
    })).toThrow();
    expect(() => publicResearchInputSchema.parse({
      ...validInput,
      consent: undefined,
    })).toThrow();
  });

  it('rejects Personal research, overlong cities, and unknown fields', () => {
    expect(() => publicResearchInputSchema.parse({ ...validInput, segment: 'personal' })).toThrow();
    expect(() => publicResearchInputSchema.parse({ ...validInput, city: 'x'.repeat(121) })).toThrow();
    expect(() => publicResearchInputSchema.parse({ ...validInput, organizationId: crypto.randomUUID() })).toThrow();
  });

  it('turns an empty optional city into undefined', () => {
    expect(publicResearchInputSchema.parse({ ...validInput, city: '   ' }).city).toBeUndefined();
  });
});

describe('public research state contracts', () => {
  it('rejects states and raw provider errors outside the finite public vocabulary', () => {
    expect(researchStatusSchema.safeParse('searching').success).toBe(false);
    expect(researchErrorCodeSchema.safeParse('HTTP 500 from provider').success).toBe(false);
  });

  it('accepts a bounded edited fact and rejects extra review fields', () => {
    const factId = crypto.randomUUID();
    expect(reviewDecisionSchema.parse({
      decision: 'accept',
      factId,
      acceptedText: '  Open Monday.  ',
    })).toEqual({ decision: 'accept', factId, acceptedText: 'Open Monday.' });

    expect(() => reviewDecisionSchema.parse({
      decision: 'reject',
      factId,
      acceptedText: 'Forged text',
    })).toThrow();
  });
});
