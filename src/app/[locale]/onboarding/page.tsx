import { notFound } from 'next/navigation';
import { ContextPicker } from '@/components/studio/context-picker';
import { getBetaMessages, parseBetaLocale } from '@/i18n/beta-messages';
import type { BetaLocale } from '@/core/secretary-profile';

type OnboardingPageProps = { params: Promise<{ locale: string }> };

function requireBetaRouteLocale(value: string): BetaLocale {
  const locale = parseBetaLocale(value);
  if (!locale) notFound();
  return locale;
}

export default async function OnboardingPage({ params }: OnboardingPageProps) {
  const locale = requireBetaRouteLocale((await params).locale);
  return <ContextPicker locale={locale} messages={getBetaMessages(locale)} />;
}
