import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from '@/brand';
import { getHomeMessages, HOME_MESSAGES } from '@/i18n/home-messages';
import { SUPPORTED_LOCALES } from '@/i18n/locales';

describe('MORDOMO home messages', () => {
  it('has a complete MORDOMO dictionary for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = getHomeMessages(locale);
      expect(HOME_MESSAGES[locale]).toBe(messages);
      expect(messages.hero.title).toContain(PRODUCT_NAME);
      expect(messages.capabilities).toHaveLength(10);
      expect(messages.languageLabel).not.toHaveLength(0);
    }
  });

  it('keeps all public-language labels and CTAs in the locale dictionary', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = getHomeMessages(locale);
      expect(messages.languageOptions).toHaveLength(5);
      expect(messages.hero.primaryCta.href).toBe('/chat');
      expect(messages.hero.secondaryCta.href).toBe('/staff');
      expect(messages.footer).toContain(PRODUCT_NAME);
    }
  });
});
