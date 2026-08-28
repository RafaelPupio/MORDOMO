import { describe, expect, it } from 'vitest';
import { getBetaMessages, parseBetaLocale } from '@/i18n/beta-messages';

describe('beta locale messages', () => {
  it('accepts only English and Portuguese beta locales', () => {
    expect(parseBetaLocale('en')).toBe('en');
    expect(parseBetaLocale('pt')).toBe('pt');
    expect(parseBetaLocale('fr')).toBeNull();
  });

  it('keeps English and Portuguese dictionaries structurally identical', () => {
    expect(Object.keys(getBetaMessages('pt')).sort()).toEqual(
      Object.keys(getBetaMessages('en')).sort(),
    );
  });
});
