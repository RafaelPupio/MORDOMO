export type Locale = 'en' | 'pt' | 'es' | 'fr' | 'de';

export const SUPPORTED_LOCALES = ['en', 'pt', 'es', 'fr', 'de'] as const satisfies readonly Locale[];

export const NON_ENGLISH_LOCALES = ['pt', 'es', 'fr', 'de'] as const satisfies readonly Exclude<Locale, 'en'>[];

export type NonEnglishLocale = (typeof NON_ENGLISH_LOCALES)[number];

export function parseLocale(value: string): Locale | null {
  return SUPPORTED_LOCALES.includes(value as Locale) ? (value as Locale) : null;
}

export function localizedPath(locale: Locale): '/' | `/${NonEnglishLocale}` {
  return locale === 'en' ? '/' : `/${locale}`;
}
