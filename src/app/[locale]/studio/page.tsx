import { notFound } from 'next/navigation';
import { SecretaryStudio } from '@/components/studio/secretary-studio';
import {
  requireSecretaryContext,
  requireStudioWriteContext,
} from '@/core/secretary-context';
import {
  DEFAULT_SECRETARY_PROFILES,
  secretaryContextKindSchema,
  type BetaLocale,
  type SecretaryContextKind,
} from '@/core/secretary-profile';
import { getDb } from '@/db/client';
import { getLatestOrganizationSecretaryProfile } from '@/db/repo/secretary-profile-versions';
import { getBetaMessages, parseBetaLocale } from '@/i18n/beta-messages';

type StudioPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ context?: string | string[] }>;
};

function requireBetaRouteLocale(value: string): BetaLocale {
  const locale = parseBetaLocale(value);
  if (!locale) notFound();
  return locale;
}

function requireStudioSelector(value: unknown): SecretaryContextKind {
  const parsed = secretaryContextKindSchema.safeParse(value ?? 'organization');
  if (!parsed.success) notFound();
  return parsed.data;
}

export default async function StudioPage({ params, searchParams }: StudioPageProps) {
  const locale = requireBetaRouteLocale((await params).locale);
  const kind = requireStudioSelector((await searchParams).context);

  if (kind === 'personal') {
    await requireSecretaryContext('personal');
    return (
      <SecretaryStudio
        initialProfile={DEFAULT_SECRETARY_PROFILES.personal}
        kind="personal"
        locale={locale}
        messages={getBetaMessages(locale)}
        versionId={undefined}
      />
    );
  }

  const context = await requireStudioWriteContext('organization');
  if (context.kind !== 'organization') notFound();
  const latest = await getLatestOrganizationSecretaryProfile(
    getDb(),
    context.organizationId,
  );

  return (
    <SecretaryStudio
      initialProfile={latest?.profile ?? DEFAULT_SECRETARY_PROFILES.organization}
      kind="organization"
      locale={locale}
      messages={getBetaMessages(locale)}
      versionId={latest?.id}
    />
  );
}
