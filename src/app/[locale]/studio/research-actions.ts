'use server';

import 'server-only';

import { refresh } from 'next/cache';
import { z } from 'zod';
import {
  publicResearchInputSchema,
  researchErrorCodeSchema,
  reviewDecisionSchema,
  type ResearchErrorCode,
} from '@/research/contracts';
import {
  createResearchServiceDeps,
  reviewOrganizationResearchFact,
  retryOrganizationResearchProposal,
  startOrganizationResearch,
} from '@/research/service';

export type ResearchActionState = {
  ok?: 'started' | 'retried' | 'reviewed';
  error?: ResearchErrorCode;
  fieldErrors?: {
    url?: 'reviewUrl';
    city?: 'reviewCity';
    consent?: 'consentRequired';
  };
};

function stableFailure(error: unknown): ResearchActionState {
  const parsed = researchErrorCodeSchema.safeParse(error);
  return { error: parsed.success ? parsed.data : 'researchUnavailable' };
}

function startFieldErrors(
  issues: z.core.$ZodIssue[],
): ResearchActionState['fieldErrors'] {
  const errors: NonNullable<ResearchActionState['fieldErrors']> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === 'url') errors.url = 'reviewUrl';
    if (field === 'city') errors.city = 'reviewCity';
    if (field === 'consent' || field === 'consentVersion') {
      errors.consent = 'consentRequired';
    }
  }
  return Object.keys(errors).length > 0 ? errors : undefined;
}

export async function startResearchAction(
  _previousState: ResearchActionState,
  formData: FormData,
): Promise<ResearchActionState> {
  const input = publicResearchInputSchema.safeParse({
    url: formData.get('url'),
    city: formData.get('city') || undefined,
    locale: formData.get('locale'),
    segment: formData.get('segment'),
    consentVersion: formData.get('consentVersion'),
    consent: formData.get('consent'),
  });
  if (!input.success) {
    return {
      error: 'invalidInput',
      fieldErrors: startFieldErrors(input.error.issues),
    };
  }

  const result = await startOrganizationResearch(
    createResearchServiceDeps(),
    'organization',
    input.data,
  );
  if (!result.ok) return stableFailure(result.error);

  refresh();
  return { ok: 'started' };
}

export async function retryResearchAction(
  _previousState: ResearchActionState,
  formData: FormData,
): Promise<ResearchActionState> {
  const briefId = z.uuid().safeParse(formData.get('briefId'));
  if (!briefId.success) return { error: 'invalidInput' };

  const result = await retryOrganizationResearchProposal(
    createResearchServiceDeps(),
    'organization',
    briefId.data,
  );
  if (!result.ok) return stableFailure(result.error);

  refresh();
  return { ok: 'retried' };
}

export async function reviewResearchFactAction(
  _previousState: ResearchActionState,
  formData: FormData,
): Promise<ResearchActionState> {
  const decision = formData.get('decision');
  const input = reviewDecisionSchema.safeParse(
    decision === 'accept'
      ? {
          decision,
          factId: formData.get('factId'),
          acceptedText: formData.get('acceptedText'),
        }
      : {
          decision,
          factId: formData.get('factId'),
        },
  );
  if (!input.success) return { error: 'invalidInput' };

  const result = await reviewOrganizationResearchFact(
    createResearchServiceDeps(),
    'organization',
    input.data,
  );
  if (!result.ok) return stableFailure(result.error);

  refresh();
  return { ok: 'reviewed' };
}
