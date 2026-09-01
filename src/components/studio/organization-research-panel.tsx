'use client';

import {
  useActionState,
  useReducer,
  useState,
  useTransition,
} from 'react';
import {
  retryResearchAction,
  reviewResearchFactAction,
  startResearchAction,
  type ResearchActionState,
} from '@/app/[locale]/studio/research-actions';
import type {
  BetaLocale,
  SecretarySegment,
} from '@/core/secretary-profile';
import {
  RESEARCH_CONSENT_VERSION,
  type OrganizationResearchDTO,
  type ResearchFactDTO,
} from '@/research/contracts';
import { RESEARCH_COPY, type ResearchCopy } from '@/research/copy';
import {
  canApplyAcceptedFacts,
  createResearchPanelState,
  isResearchPanelLocked,
  reduceResearchPanelState,
} from '@/research/panel-state';

type OrganizationResearchPanelProps = {
  research: OrganizationResearchDTO;
  locale: BetaLocale;
  responseLocale: BetaLocale;
  segment: Exclude<SecretarySegment, 'personal'>;
  initialAppliedFactIds: string[];
  onApply: (factIds: string[]) => void;
};

const EMPTY_RESEARCH_STATE: ResearchActionState = {};

function feedbackText(
  state: ResearchActionState | undefined,
  copy: ResearchCopy,
): string {
  if (!state) return '';
  if (state.error) return copy.errors[state.error];
  if (state.ok) return copy.pending;
  return '';
}

function SourceReference({
  source,
  copy,
}: {
  source: NonNullable<OrganizationResearchDTO['source']>;
  copy: ResearchCopy;
}) {
  return (
    <div className="border-l-4 border-[#256d85] bg-[#e0f2fe] px-4 py-3">
      <p className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[#102421]/55">
        {copy.sourceLabel}
      </p>
      <a
        className="mt-1 block break-words text-sm font-semibold underline decoration-[#256d85]/40 underline-offset-4 hover:decoration-[#256d85] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#167052]"
        href={source.url}
        rel="noreferrer noopener"
        target="_blank"
      >
        {source.title}
      </a>
    </div>
  );
}

function StartResearchForm({
  action,
  copy,
  fieldErrors,
  locked,
  onEdit,
  responseLocale,
  segment,
}: {
  action: (formData: FormData) => void;
  copy: ResearchCopy;
  fieldErrors?: ResearchActionState['fieldErrors'];
  locked: boolean;
  onEdit: (field: 'url' | 'city' | 'consent') => void;
  responseLocale: BetaLocale;
  segment: Exclude<SecretarySegment, 'personal'>;
}) {
  return (
    <form action={action} className="grid gap-5 border-t border-[#102421]/15 p-5 sm:p-7">
      <input name="segment" type="hidden" value={segment} />
      <input name="locale" type="hidden" value={responseLocale} />
      <input
        name="consentVersion"
        type="hidden"
        value={RESEARCH_CONSENT_VERSION}
      />
      <fieldset className="grid gap-5 sm:grid-cols-2" disabled={locked}>
        <legend className="sr-only">{copy.start}</legend>
        <label className="block text-sm font-semibold sm:col-span-2">
          {copy.urlLabel}
          <input
            aria-describedby="research-url-hint research-url-error"
            aria-invalid={Boolean(fieldErrors?.url)}
            className="mt-2 min-h-11 w-full border border-[#102421]/25 px-3 font-normal focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7]"
            maxLength={2048}
            name="url"
            onChange={() => onEdit('url')}
            placeholder="https://example.org/about"
            required
            type="url"
          />
          <span className="mt-1 block text-xs font-normal leading-5 text-[#102421]/60" id="research-url-hint">
            {copy.urlHint}
          </span>
          <span className="mt-1 block min-h-4 text-xs font-normal text-[#a14232]" id="research-url-error">
            {fieldErrors?.url ? copy.fieldErrors[fieldErrors.url] : ''}
          </span>
        </label>
        <label className="block text-sm font-semibold sm:col-span-2">
          {copy.cityLabel}
          <input
            aria-describedby="research-city-hint research-city-error"
            aria-invalid={Boolean(fieldErrors?.city)}
            className="mt-2 min-h-11 w-full border border-[#102421]/25 px-3 font-normal focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7]"
            maxLength={120}
            name="city"
            onChange={() => onEdit('city')}
          />
          <span className="mt-1 block text-xs font-normal leading-5 text-[#102421]/60" id="research-city-hint">
            {copy.cityHint}
          </span>
          <span className="mt-1 block min-h-4 text-xs font-normal text-[#a14232]" id="research-city-error">
            {fieldErrors?.city ? copy.fieldErrors[fieldErrors.city] : ''}
          </span>
        </label>
        <label className="flex items-start gap-3 border border-[#102421]/15 bg-[#f4f7f5] p-4 text-sm leading-6 sm:col-span-2">
          <input
            aria-describedby="research-consent-error"
            aria-invalid={Boolean(fieldErrors?.consent)}
            className="mt-1 size-4 shrink-0 accent-[#167052] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7]"
            name="consent"
            onChange={() => onEdit('consent')}
            required
            type="checkbox"
          />
          <span>{copy.consent}</span>
        </label>
        <span className="-mt-3 min-h-4 text-xs text-[#a14232] sm:col-span-2" id="research-consent-error">
          {fieldErrors?.consent ? copy.fieldErrors[fieldErrors.consent] : ''}
        </span>
        <button
          className="min-h-11 justify-self-start bg-[#102421] px-5 py-3 text-sm font-semibold text-white hover:bg-[#193a34] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#6ee7b7] disabled:cursor-not-allowed disabled:opacity-45 sm:col-span-2"
          disabled={locked}
          type="submit"
        >
          {copy.start}
        </button>
      </fieldset>
    </form>
  );
}

function ProposedFactReview({
  action,
  copy,
  fact,
  locked,
}: {
  action: (formData: FormData) => void;
  copy: ResearchCopy;
  fact: ResearchFactDTO;
  locked: boolean;
}) {
  if (fact.reviewStatus !== 'proposed') {
    return (
      <article className="border border-[#102421]/15 bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-semibold leading-6">{fact.acceptedText ?? fact.proposedText}</p>
          <span className={`shrink-0 px-2 py-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] ${fact.reviewStatus === 'accepted' ? 'bg-[#d1fae5] text-[#0d5c43]' : 'bg-[#f3f4f6] text-[#102421]/55'}`}>
            {fact.reviewStatus === 'accepted' ? copy.accepted : copy.rejected}
          </span>
        </div>
        <blockquote className="mt-3 border-l-2 border-[#256d85] pl-3 text-xs leading-5 text-[#102421]/65">
          <span className="font-mono text-[0.6rem] font-bold uppercase tracking-[0.14em]">{copy.supportingQuote}</span>
          <span className="mt-1 block">“{fact.supportingQuote}”</span>
        </blockquote>
      </article>
    );
  }

  return (
    <article className="border border-[#102421]/20 bg-white">
      <div className="grid gap-3 border-b border-[#102421]/10 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.65fr)]">
        <p className="text-sm font-semibold leading-6">{fact.proposedText}</p>
        <blockquote className="border-l-2 border-[#256d85] pl-3 text-xs leading-5 text-[#102421]/65">
          <span className="font-mono text-[0.6rem] font-bold uppercase tracking-[0.14em]">{copy.supportingQuote}</span>
          <span className="mt-1 block">“{fact.supportingQuote}”</span>
        </blockquote>
      </div>
      <div className="grid gap-3 bg-[#f4f7f5] p-4 sm:grid-cols-2">
        <form action={action}>
          <input name="decision" type="hidden" value="accept" />
          <input name="factId" type="hidden" value={fact.id} />
          <input name="acceptedText" type="hidden" value={fact.proposedText} />
          <button
            className="min-h-11 w-full bg-[#167052] px-4 py-2 text-sm font-semibold text-white hover:bg-[#10573f] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7] disabled:opacity-45"
            disabled={locked}
            type="submit"
          >
            {copy.accept}
          </button>
        </form>
        <form action={action} className="grid gap-2 sm:row-span-2">
          <input name="decision" type="hidden" value="accept" />
          <input name="factId" type="hidden" value={fact.id} />
          <label className="text-xs font-semibold">
            {copy.editAndAccept}
            <textarea
              className="mt-2 min-h-20 w-full resize-y border border-[#102421]/25 bg-white px-3 py-2 text-sm font-normal leading-5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7]"
              defaultValue={fact.proposedText}
              disabled={locked}
              maxLength={280}
              name="acceptedText"
              required
            />
          </label>
          <button
            className="min-h-11 border border-[#167052] bg-white px-4 py-2 text-sm font-semibold text-[#0d5c43] hover:bg-[#d1fae5] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7] disabled:opacity-45"
            disabled={locked}
            type="submit"
          >
            {copy.editAndAccept}
          </button>
        </form>
        <form action={action}>
          <input name="decision" type="hidden" value="reject" />
          <input name="factId" type="hidden" value={fact.id} />
          <button
            className="min-h-11 w-full border border-[#102421]/25 bg-white px-4 py-2 text-sm font-semibold hover:border-[#a14232] hover:text-[#a14232] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#d9a62e] disabled:opacity-45"
            disabled={locked}
            type="submit"
          >
            {copy.reject}
          </button>
        </form>
      </div>
    </article>
  );
}

export function OrganizationResearchPanel({
  research,
  locale,
  responseLocale,
  segment,
  initialAppliedFactIds,
  onApply,
}: OrganizationResearchPanelProps) {
  const copy = RESEARCH_COPY[locale];
  const [panelState, dispatch] = useReducer(
    reduceResearchPanelState,
    initialAppliedFactIds,
    createResearchPanelState,
  );
  const [, startAction, startPending] = useActionState(
    async (_previous: ResearchActionState, formData: FormData) => {
      dispatch({ type: 'actionStarted', action: 'start' });
      const result = await startResearchAction(EMPTY_RESEARCH_STATE, formData);
      dispatch({ type: 'actionFinished', result });
      return result;
    },
    EMPTY_RESEARCH_STATE,
  );
  const [, reviewAction, reviewPending] = useActionState(
    async (_previous: ResearchActionState, formData: FormData) => {
      dispatch({ type: 'actionStarted', action: 'review' });
      const result = await reviewResearchFactAction(EMPTY_RESEARCH_STATE, formData);
      dispatch({ type: 'actionFinished', result });
      return result;
    },
    EMPTY_RESEARCH_STATE,
  );
  const [retryState, setRetryState] = useState<ResearchActionState>();
  const [retryPending, startRetryTransition] = useTransition();

  const locked = startPending
    || reviewPending
    || retryPending
    || isResearchPanelLocked(panelState);
  const feedback = panelState.feedback ?? retryState;
  const serverError = research.error ? copy.errors[research.error] : '';
  const fieldErrors = feedback?.fieldErrors;
  const acceptedFactIds = research.facts
    .filter((fact) => fact.reviewStatus === 'accepted')
    .map((fact) => fact.id);
  const canApply = canApplyAcceptedFacts({ facts: research.facts, pending: locked });

  function retryProposal() {
    if (!research.briefId || locked) return;
    const formData = new FormData();
    formData.set('briefId', research.briefId);
    dispatch({ type: 'actionStarted', action: 'retry' });
    startRetryTransition(async () => {
      const result = await retryResearchAction(EMPTY_RESEARCH_STATE, formData);
      setRetryState(result);
      dispatch({ type: 'actionFinished', result });
    });
  }

  function applyAcceptedFacts() {
    if (!canApply) return;
    dispatch({ type: 'applyAccepted', factIds: acceptedFactIds });
    onApply(acceptedFactIds);
  }

  const showStart = !research.status
    || (research.status === 'failed' && !research.source);
  const showReview = research.status === 'review_ready'
    || research.status === 'applied';

  return (
    <section className="border border-[#102421]/20 bg-[#fffefb]" aria-labelledby="research-panel-title">
      <div className="grid gap-3 border-b border-[#102421]/15 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:px-7">
        <div>
          <p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.2em] text-[#167052]">{copy.eyebrow}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]" id="research-panel-title">{copy.title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#102421]/65">{copy.description}</p>
        </div>
        <div className="grid grid-cols-3 border border-[#102421]/15 font-mono text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[#102421]/55" aria-hidden="true">
          <span className="border-r border-[#102421]/15 px-2 py-2">01 Source</span>
          <span className="border-r border-[#102421]/15 px-2 py-2">02 Quote</span>
          <span className="px-2 py-2">03 Decide</span>
        </div>
      </div>

      {!research.available ? (
        <p className="m-5 border-l-4 border-[#d9a62e] bg-[#fef3c7] px-4 py-3 text-sm leading-6 sm:m-7">
          {copy.unavailable}
        </p>
      ) : null}

      {research.available && showStart ? (
        <>
          {serverError ? <p className="px-5 pt-5 text-sm font-semibold text-[#a14232] sm:px-7">{serverError}</p> : null}
          <StartResearchForm
            action={startAction}
            copy={copy}
            fieldErrors={fieldErrors}
            locked={locked}
            onEdit={(field) => dispatch({ type: 'fieldEdited', field })}
            responseLocale={responseLocale}
            segment={segment}
          />
        </>
      ) : null}

      {research.available && research.status === 'retrieving' ? (
        <p className="m-5 border-l-4 border-[#256d85] bg-[#e0f2fe] px-4 py-4 text-sm font-semibold sm:m-7" role="status">
          {copy.retrieving}
        </p>
      ) : null}

      {research.available && (research.status === 'source_ready' || research.status === 'proposing') ? (
        <p className="m-5 border-l-4 border-[#256d85] bg-[#e0f2fe] px-4 py-4 text-sm font-semibold sm:m-7" role="status">
          {copy.proposing}
        </p>
      ) : null}

      {research.available && research.status === 'failed' && research.source ? (
        <div className="grid gap-4 p-5 sm:p-7">
          <SourceReference copy={copy} source={research.source} />
          <p className="text-sm font-semibold text-[#a14232]">{serverError}</p>
          <p className="text-sm leading-6 text-[#102421]/65">{copy.retryHint}</p>
          <form action={retryProposal}>
            <input name="briefId" type="hidden" value={research.briefId} />
            <button
              className="min-h-11 bg-[#102421] px-5 py-3 text-sm font-semibold text-white hover:bg-[#193a34] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#6ee7b7] disabled:opacity-45"
              disabled={locked}
              type="submit"
            >
              {copy.retry}
            </button>
          </form>
        </div>
      ) : null}

      {research.available && showReview ? (
        <div className="grid gap-5 p-5 sm:p-7">
          {research.source ? <SourceReference copy={copy} source={research.source} /> : null}
          <div>
            <p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[#167052]">{copy.reviewTitle}</p>
            <div className="mt-3 grid gap-3">
              {research.facts.map((fact) => (
                <ProposedFactReview
                  action={reviewAction}
                  copy={copy}
                  fact={fact}
                  key={fact.id}
                  locked={locked}
                />
              ))}
            </div>
          </div>
          {research.facts.length === 0 ? (
            <p className="border-l-4 border-[#d9a62e] bg-[#fef3c7] px-4 py-3 text-sm leading-6">{copy.noGroundedFacts}</p>
          ) : null}
          {canApply ? (
            <button
              className="min-h-11 justify-self-start bg-[#167052] px-5 py-3 text-sm font-semibold text-white hover:bg-[#10573f] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#6ee7b7]"
              onClick={applyAcceptedFacts}
              type="button"
            >
              {copy.apply}
            </button>
          ) : null}
          {panelState.dirty || research.status === 'applied' ? (
            <p className="border-l-4 border-[#167052] bg-[#d1fae5] px-4 py-3 text-sm leading-6">
              <strong>{copy.applied}</strong> {copy.savedSeparately}
            </p>
          ) : null}
        </div>
      ) : null}

      <p aria-live="polite" className="min-h-6 px-5 pb-5 text-sm font-semibold text-[#167052] sm:px-7 sm:pb-7">
        {locked ? copy.pending : feedbackText(feedback, copy)}
      </p>
    </section>
  );
}
