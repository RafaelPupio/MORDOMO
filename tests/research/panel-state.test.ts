import { describe, expect, it } from 'vitest';
import {
  canApplyAcceptedFacts,
  createResearchPanelState,
  isResearchPanelLocked,
  reduceResearchPanelState,
} from '@/research/panel-state';
import type { ResearchFactDTO } from '@/research/contracts';

const acceptedFact: ResearchFactDTO = {
  id: '11111111-1111-4111-8111-111111111111',
  proposedText: 'Open Monday.',
  supportingQuote: 'Open Monday',
  reviewStatus: 'accepted',
  acceptedText: 'Open Monday.',
};
const rejectedFact: ResearchFactDTO = {
  id: '22222222-2222-4222-8222-222222222222',
  proposedText: 'Open Sunday.',
  supportingQuote: 'Open Sunday',
  reviewStatus: 'rejected',
};
const proposedFact: ResearchFactDTO = {
  id: '33333333-3333-4333-8333-333333333333',
  proposedText: 'Open Tuesday.',
  supportingQuote: 'Open Tuesday',
  reviewStatus: 'proposed',
};

describe('research panel state', () => {
  it('allows apply only after all facts are reviewed and at least one is accepted', () => {
    expect(canApplyAcceptedFacts({
      facts: [acceptedFact, rejectedFact],
      pending: false,
    })).toBe(true);
    expect(canApplyAcceptedFacts({
      facts: [acceptedFact, proposedFact],
      pending: false,
    })).toBe(false);
    expect(canApplyAcceptedFacts({
      facts: [acceptedFact, rejectedFact],
      pending: true,
    })).toBe(false);
    expect(canApplyAcceptedFacts({ facts: [rejectedFact], pending: false })).toBe(false);
  });

  it('applies only accepted IDs and marks the profile draft dirty', () => {
    const initial = createResearchPanelState([]);

    expect(reduceResearchPanelState(initial, {
      type: 'applyAccepted',
      factIds: [acceptedFact.id],
    })).toMatchObject({
      appliedFactIds: [acceptedFact.id],
      dirty: true,
    });
  });

  it('locks duplicate work while any research action is pending', () => {
    const pending = reduceResearchPanelState(createResearchPanelState([]), {
      type: 'actionStarted',
      action: 'retry',
    });

    expect(isResearchPanelLocked(pending)).toBe(true);
    expect(pending.pending).toBe('retry');
  });

  it.each(['url', 'consent'] as const)('clears stale feedback when %s changes', (field) => {
    const failed = reduceResearchPanelState(createResearchPanelState([]), {
      type: 'actionFinished',
      result: { error: 'unsafeUrl', fieldErrors: { url: 'reviewUrl' } },
    });

    expect(reduceResearchPanelState(failed, {
      type: 'fieldEdited',
      field,
    }).feedback).toBeUndefined();
  });

  it('a retry cannot clear the server-owned source', () => {
    const research = {
      available: true,
      briefId: '44444444-4444-4444-8444-444444444444',
      status: 'failed' as const,
      source: { title: 'Fictional source', url: 'https://example.com/about' },
      facts: [],
    };
    const panel = reduceResearchPanelState(createResearchPanelState([]), {
      type: 'actionStarted',
      action: 'retry',
    });

    expect({ research, panel }).toMatchObject({
      research: { source: research.source },
      panel: { pending: 'retry' },
    });
  });

  it('locale changes preserve loaded brief and applied fact IDs', () => {
    const research = {
      briefId: '44444444-4444-4444-8444-444444444444',
      facts: [acceptedFact],
    };
    const initial = createResearchPanelState([acceptedFact.id]);
    const panel = reduceResearchPanelState(initial, {
      type: 'localeChanged',
      locale: 'pt',
    });

    expect({ research, panel }).toMatchObject({
      research: {
        briefId: '44444444-4444-4444-8444-444444444444',
        facts: [{ id: acceptedFact.id }],
      },
      panel: { appliedFactIds: [acceptedFact.id] },
    });
  });
});
