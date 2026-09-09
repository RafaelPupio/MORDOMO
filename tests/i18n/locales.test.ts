import { describe, expect, it } from 'vitest';
import { localizedPath, parseLocale, SUPPORTED_LOCALES } from '@/i18n/locales';

describe('marketing locale routing', () => {
  it('accepts only the five supported locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'pt', 'es', 'fr', 'de']);
    expect(parseLocale('pt')).toBe('pt');
    expect(parseLocale('it')).toBeNull();
  });

  it('keeps English canonical at the root path', () => {
    expect(localizedPath('en')).toBe('/');
    expect(localizedPath('fr')).toBe('/fr');
  });
});
