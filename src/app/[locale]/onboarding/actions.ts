'use server';

import { redirect } from 'next/navigation';
import {
  ensureActiveClerkOrganization,
  requireSecretaryContext,
} from '@/core/secretary-context';
import {
  betaLocaleSchema,
  secretaryContextKindSchema,
} from '@/core/secretary-profile';
import { getDb } from '@/db/client';

export type OnboardingActionState = {
  error?: 'invalid' | 'forbidden' | 'organizationRequired';
};

export async function enterSecretaryContext(
  localeInput: string,
  kindInput: string,
): Promise<OnboardingActionState> {
  const locale = betaLocaleSchema.safeParse(localeInput);
  const kind = secretaryContextKindSchema.safeParse(kindInput);
  if (!locale.success || !kind.success) return { error: 'invalid' };

  try {
    if (kind.data === 'organization') {
      await ensureActiveClerkOrganization(getDb());
    } else {
      await requireSecretaryContext('personal');
    }
  } catch {
    return {
      error: kind.data === 'organization' ? 'organizationRequired' : 'forbidden',
    };
  }

  redirect(`/${locale.data}/studio?context=${kind.data}`);
}
