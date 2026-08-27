import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MordomoHome } from '@/components/marketing/mordomo-home';
import { getHomeMessages } from '@/i18n/home-messages';
import { NON_ENGLISH_LOCALES, parseLocale, type Locale } from '@/i18n/locales';

type LocalePageProps = { params: Promise<{ locale: string }> };

function requireLocale(value: string): Locale {
  const locale = parseLocale(value);
  if (!locale || locale === 'en') notFound();
  return locale;
}

export function generateStaticParams() {
  return NON_ENGLISH_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LocalePageProps): Promise<Metadata> {
  return getHomeMessages(requireLocale((await params).locale)).metadata;
}

export default async function LocalizedHome({ params }: LocalePageProps) {
  return <MordomoHome locale={requireLocale((await params).locale)} />;
}

