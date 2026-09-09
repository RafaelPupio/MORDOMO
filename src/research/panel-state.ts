import type { ResearchActionState } from '@/app/[locale]/studio/research-actions';
import type { BetaLocale } from '@/core/secretary-profile';
import type { ResearchFactDTO } from '@/research/contracts';

export type ResearchPendingAction = 'start' | 'retry' | 'review';

export type ResearchPanelState = {
  pending?: ResearchPendingAction;
  feedback?: ResearchActionState;
  appliedFactIds: string[];
  dirty: boolean;
};

export type ResearchPanelEvent =
  | { type: 'actionStarted'; action: ResearchPendingAction }
  | { type: 'actionFinished'; result: ResearchActionState }
  | { type: 'fieldEdited'; field: 'url' | 'city' | 'consent' }
  | { type: 'applyAccepted'; factIds: string[] }
  | { type: 'localeChanged'; locale: BetaLocale };

export function createResearchPanelState(
  initialAppliedFactIds: string[],
): ResearchPanelState {
  return {
    appliedFactIds: [...new Set(initialAppliedFactIds)].slice(0, 12),
    dirty: false,
  };
}

export function reduceResearchPanelState(
  state: ResearchPanelState,
  event: ResearchPanelEvent,
): ResearchPanelState {
  if (event.type === 'actionStarted') {
    return { ...state, pending: event.action, feedback: undefined };
  }
  if (event.type === 'actionFinished') {
    return { ...state, pending: undefined, feedback: event.result };
  }
  if (event.type === 'fieldEdited') {
    return { ...state, feedback: undefined };
  }
  if (event.type === 'applyAccepted') {
    return {
      ...state,
      appliedFactIds: [...new Set(event.factIds)].slice(0, 12),
      dirty: true,
      feedback: undefined,
    };
  }
  return state;
}

export function isResearchPanelLocked(state: ResearchPanelState): boolean {
  return state.pending !== undefined;
}

export function canApplyAcceptedFacts({
  facts,
  pending,
}: {
  facts: ResearchFactDTO[];
  pending: boolean;
}): boolean {
  return !pending
    && facts.length > 0
    && facts.every((fact) => fact.reviewStatus !== 'proposed')
    && facts.some((fact) => fact.reviewStatus === 'accepted');
}
