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
  assertResearchReadyToApply,
  listAcceptedResearchFacts,
  markResearchApplied,
  recordDataControlEvent,
} from '@/db/repo/public-research';
import {
  publishOrganizationSecretaryProfile,
  saveOrganizationSecretaryProfileDraft,
} from '@/db/repo/secretary-profile-versions';

export type StudioActionState = {
  ok?: 'draftSaved' | 'published';
  error?: 'forbidden' | 'invalid' | 'notFound' | 'personalNotSaved' | 'unavailable';
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

async function getAuthorizedOrganizationContext(
  kind: SecretaryContextKind,
): Promise<Extract<Awaited<ReturnType<typeof requireStudioWriteContext>>, { kind: 'organization' }> | null> {
  try {
    const context = await requireStudioWriteContext(kind);
    return context.kind === 'organization' ? context : null;
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

  const context = await getAuthorizedOrganizationContext(kind.data);
  if (!context) return { error: 'forbidden' };
  const organizationId = context.organizationId;

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
    const briefIds = new Set<string>();
    for (const id of uniqueFactIds) {
      const fact = factsById.get(id);
      if (!fact) return { error: 'invalid' };
      briefIds.add(fact.briefId);
      approvedPublicFacts.push({
        researchFactId: fact.researchFactId,
        sourceId: fact.sourceId,
        text: fact.text,
        sourceTitle: fact.sourceTitle,
        sourceUrl: fact.sourceUrl,
      });
    }
    const briefStates = new Map<string, 'review_ready' | 'applied'>();
    try {
      const statuses = await Promise.all([...briefIds].map((briefId) => (
        assertResearchReadyToApply(db, organizationId, briefId)
      )));
      [...briefIds].forEach((briefId, index) => {
        briefStates.set(briefId, statuses[index]);
      });
    } catch {
      return { error: 'invalid' };
    }
    const saved = await saveOrganizationSecretaryProfileDraft(
      db,
      organizationId,
      { ...parsed.data, approvedPublicFacts },
    );
    for (const [briefId, status] of briefStates) {
      if (status === 'applied') continue;
      await markResearchApplied(db, organizationId, briefId);
      await recordDataControlEvent(db, {
        organizationId,
        actorClerkUserId: context.userId,
        action: 'research.applied',
        targetType: 'profile_version',
        targetId: saved.id,
        outcome: 'succeeded',
      });
    }
    return { ok: 'draftSaved' };
  } catch {
    return { error: 'unavailable' };
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

  const context = await getAuthorizedOrganizationContext(kind.data);
  if (!context) return { error: 'forbidden' };
  const organizationId = context.organizationId;

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
