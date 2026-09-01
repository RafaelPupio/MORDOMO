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
import { listAcceptedResearchFacts } from '@/db/repo/public-research';
import {
  publishOrganizationSecretaryProfile,
  saveOrganizationSecretaryProfileDraft,
} from '@/db/repo/secretary-profile-versions';

export type StudioActionState = {
  ok?: 'draftSaved' | 'published';
  error?: 'forbidden' | 'invalid' | 'notFound' | 'personalNotSaved';
  fieldErrors?: Partial<Record<keyof SecretaryProfile, StudioFieldErrorCode>>;
};

export type StudioFieldErrorCode = 'reviewField' | 'personalPreviewOnly';

const versionIdSchema = z.uuid();
const approvedPublicFactIdsSchema = z.array(z.uuid()).max(12);
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
      errors[field as keyof SecretaryProfile] ??= 'reviewField';
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
      fieldErrors: { segment: 'personalPreviewOnly' },
    };
  }

  const factIds = approvedPublicFactIdsSchema.safeParse(
    formData.getAll('approvedPublicFactIds'),
  );
  if (!factIds.success) return { error: 'invalid' };
  const uniqueFactIds = [...new Set(factIds.data)];

  try {
    const db = getDb();
    const resolvedFacts = await listAcceptedResearchFacts(
      db,
      organizationId,
      uniqueFactIds,
    );
    const factsById = new Map(
      resolvedFacts.map((fact) => [fact.researchFactId, fact]),
    );
    const approvedPublicFacts = [];
    for (const id of uniqueFactIds) {
      const fact = factsById.get(id);
      if (!fact) return { error: 'invalid' };
      approvedPublicFacts.push(fact);
    }
    await saveOrganizationSecretaryProfileDraft(
      db,
      organizationId,
      { ...parsed.data, approvedPublicFacts },
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
