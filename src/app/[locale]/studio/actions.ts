'use server';

import { z } from 'zod';
import {
  requireSecretaryContext,
  requireStudioWriteContext,
} from '@/core/secretary-context';
import {
  secretaryContextKindSchema,
  secretaryProfileSchema,
  type SecretaryContextKind,
  type SecretaryProfile,
} from '@/core/secretary-profile';
import { getDb } from '@/db/client';
import {
  publishOrganizationSecretaryProfile,
  saveOrganizationSecretaryProfileDraft,
} from '@/db/repo/secretary-profile-versions';

export type StudioActionState = {
  ok?: 'draftSaved' | 'published';
  error?: 'forbidden' | 'invalid' | 'notFound' | 'personalNotSaved';
  fieldErrors?: Partial<Record<keyof SecretaryProfile, string>>;
};

const versionIdSchema = z.uuid();
const PROFILE_FIELDS = new Set<keyof SecretaryProfile>([
  'segment',
  'defaultLocale',
  'assistantName',
  'replyTone',
  'greeting',
  'escalationCopy',
  'enabledCapabilities',
]);

function toFieldErrors(error: z.ZodError): StudioActionState['fieldErrors'] {
  const errors: StudioActionState['fieldErrors'] = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && PROFILE_FIELDS.has(field as keyof SecretaryProfile)) {
      errors[field as keyof SecretaryProfile] ??= 'Review this field.';
    }
  }
  return errors;
}

async function getAuthorizedOrganizationId(
  kind: SecretaryContextKind,
): Promise<string | null> {
  try {
    const context = await requireStudioWriteContext(kind);
    return context.kind === 'organization' ? context.organizationId : null;
  } catch {
    return null;
  }
}

export async function saveStudioDraft(
  kindInput: SecretaryContextKind,
  formData: FormData,
): Promise<StudioActionState> {
  const kind = secretaryContextKindSchema.safeParse(kindInput);
  if (!kind.success) return { error: 'notFound' };

  if (kind.data === 'personal') {
    try {
      await requireSecretaryContext('personal');
    } catch {
      return { error: 'forbidden' };
    }
    return { error: 'personalNotSaved' };
  }

  const organizationId = await getAuthorizedOrganizationId(kind.data);
  if (!organizationId) return { error: 'forbidden' };

  const parsed = secretaryProfileSchema.safeParse({
    segment: formData.get('segment'),
    defaultLocale: formData.get('defaultLocale'),
    assistantName: formData.get('assistantName'),
    replyTone: formData.get('replyTone'),
    greeting: formData.get('greeting'),
    escalationCopy: formData.get('escalationCopy'),
    enabledCapabilities: formData.getAll('enabledCapabilities'),
  });

  if (!parsed.success) {
    return {
      error: 'invalid',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  if (parsed.data.segment === 'personal') {
    return {
      error: 'invalid',
      fieldErrors: { segment: 'Personal is preview-only in this beta.' },
    };
  }

  try {
    await saveOrganizationSecretaryProfileDraft(
      getDb(),
      organizationId,
      parsed.data,
    );
    return { ok: 'draftSaved' };
  } catch {
    return { error: 'forbidden' };
  }
}

export async function publishStudioProfile(
  kindInput: SecretaryContextKind,
  versionIdInput: string,
): Promise<StudioActionState> {
  const kind = secretaryContextKindSchema.safeParse(kindInput);
  if (!kind.success) return { error: 'notFound' };

  if (kind.data === 'personal') {
    try {
      await requireSecretaryContext('personal');
    } catch {
      return { error: 'forbidden' };
    }
    return { error: 'personalNotSaved' };
  }

  const organizationId = await getAuthorizedOrganizationId(kind.data);
  if (!organizationId) return { error: 'forbidden' };

  const versionId = versionIdSchema.safeParse(versionIdInput);
  if (!versionId.success) return { error: 'invalid' };

  try {
    await publishOrganizationSecretaryProfile(
      getDb(),
      organizationId,
      versionId.data,
    );
    return { ok: 'published' };
  } catch {
    return { error: 'notFound' };
  }
}
