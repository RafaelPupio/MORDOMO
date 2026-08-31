# MORDOMO Organization Public Research — Design

**Date:** 2026-08-31

**Status:** Approved in conversation; written specification pending review

**Scope:** Delivery Gate 3 from the Corporate + Personal Beta design: one-client-approved-site research for Organization contexts only.

## Goal

An authorized Organization owner or admin can ask MORDOMO to inspect one approved public
website, receive grounded public-fact proposals, review every proposal, and deliberately add
accepted facts to a secretary-profile draft. Research never changes a draft or published
profile automatically.

This increment is not open-web search and is not an autonomous researcher. It adds one
bounded, auditable source-review workflow while preserving the existing trusted-context,
explicit-save, explicit-publish, and cost-metering boundaries.

This design is an addendum to
`docs/superpowers/specs/2026-08-28-corporate-personal-beta-design.md`. That document remains
authoritative for the broader beta.

## Hard prerequisites

Implementation may begin only after these prerequisites are real rather than mocked:

1. Firecrawl is provisioned through the Vercel Marketplace for this project. The generated
   environment-variable names and installed product contract are inspected before code refers
   to them.
2. Firecrawl enables zero data retention for the installed team. A bounded fictional scrape
   with `zeroDataRetention: true` succeeds before the app-owned research enable switch is set.
3. The app always sends `storeInCache: false`. Firecrawl documents both flags on its
   [Scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape); the ZDR capability
   requires provider enablement rather than merely sending a boolean.
4. AI Gateway data-handling controls are reviewed for the public excerpt, segment, city, and
   generated proposals. No private notes, chat history, member data, or credentials enter the
   research path.
5. The exact bilingual consent copy in this specification is approved during written-spec
   review.

The app-owned `RESEARCH_ZDR_VERIFIED` server setting must equal the literal string `true` for
live research to render or execute. This setting is separate from the Firecrawl credential
whose exact generated name is discovered during provisioning.

Firecrawl's public privacy policy does not promise automatic recurring deletion of personal
information and describes United States storage. This workflow therefore limits inputs to an
approved public site and remains disabled unless the ZDR prerequisite is verified. See the
[Firecrawl Privacy Policy](https://www.firecrawl.dev/privacy-policy).

## Approaches considered

### 1. Staged server workflow — selected

One user action starts a server-orchestrated flow. MORDOMO stores the bounded source after the
scrape, then separately generates fact proposals from that stored source. If AI generation
fails, a retry reuses the source and does not pay for another scrape.

This keeps the beta understandable and recoverable without adding a workflow platform.

### 2. Source capture with manually authored facts

This avoids a model call, but it does not deliver the approved proposed-facts experience and
places too much transcription work on the beta client.

### 3. Durable workflow infrastructure

A durable workflow is appropriate for broad crawling or long-running research. It is excess
infrastructure for one page, one extraction call, and one human review step, so it is deferred.

Firecrawl Agent, Extract, open-web Search, and Crawl are not used. Provider-side AI would
bypass the project's sole AI Gateway path and could not satisfy the existing token/cost ledger
contract.

## Architecture

The feature is split into small units with one responsibility each:

- `public-research-input` validates and normalizes consent, URL, city, locale, and segment.
- `public-research-provider` exposes a one-page scrape contract. The Firecrawl adapter is its
  only live implementation; tests use a deterministic fake.
- `public-research-orchestrator` owns authorization, state transitions, rate/budget gates,
  source persistence, proposal generation, and sanitized failure mapping.
- `public-fact-proposer` calls AI Gateway through the existing AI SDK model path, validates a
  strict result, verifies supporting quotes, and meters usage.
- Research repositories provide tenant-scoped brief, source, fact, and audit operations.
- `OrganizationResearchPanel` owns the bilingual client workflow without adding research
  state to the existing `SecretaryStudio` component.

The provider and proposer depend on narrow TypeScript interfaces. Domain orchestration does
not import a Firecrawl SDK directly, and the UI does not know provider response shapes.

## Trusted data flow

1. The server re-resolves the active Clerk session and Organization. Only the existing
   `owner` or `admin` Studio roles may proceed.
2. The server validates the Organization context, input, consent version, URL, and feature
   enablement. Personal contexts fail before any research lookup or network call.
3. A research-specific rate-limit key and the existing tenant/global AI budget gates are
   checked before external work.
4. A pending brief is inserted. A partial unique index permits at most one active research
   brief per Organization.
5. Firecrawl receives only the normalized approved URL and fixed scrape options. It does not
   receive the Organization ID, Clerk identity, segment, city, cookies, headers, private
   content, model prompt, or prior research.
6. The returned final URL is checked against the approved host. Clean markdown is normalized,
   bounded, and stored as the Organization's public source excerpt.
7. AI Gateway receives the bounded untrusted excerpt plus the selected public segment, optional
   city, and response language. The model has no tools and cannot request more pages.
8. Exact model usage is sent to `usage_ledger` under `research.fact_proposal`. A result is not
   persisted as reviewable facts if usage recording fails.
9. The complete structured result is rejected unless every proposal contains a supporting
   quote present in the stored excerpt after whitespace normalization.
10. Proposed facts remain inert until an authorized reviewer accepts, edits-and-accepts, or
    rejects each one.
11. Applying accepted facts selects their IDs in the local Studio draft. A later explicit Save
    re-resolves those IDs in the active Organization and materializes bounded snapshots into a
    new profile version. Publish remains a separate action.

## URL and content boundary

The beta accepts exactly one URL per brief. Server validation requires:

- HTTPS with the default port only;
- no username, password, fragment, or query string;
- a DNS hostname rather than an IP literal;
- rejection of localhost and reserved/local hostname forms;
- a bounded path and total URL length;
- a returned final hostname equal to the submitted hostname or its direct `www` variant.

The Firecrawl call uses one-page Scrape with markdown, main-content extraction,
`zeroDataRetention: true`, and `storeInCache: false`. It never supplies actions, browser
profiles, screenshots, custom headers, authentication, file uploads, or TLS bypasses.

These controls reduce the request surface; they do not claim that MORDOMO itself performed the
remote fetch. Firecrawl remains responsible for its own network-level SSRF protections. The
app sends no secrets or private context that a malicious page could exfiltrate.

Stored content is public but still untrusted. The app strips control characters, bounds the
excerpt by characters before model input and persistence, and never interprets scraped HTML or
JavaScript in the browser. Research UI renders text, not provider HTML.

## Fixed limits

- Submitted URL: 2,048 characters; path: 1,024 characters
- City: 120 characters
- Source title: 200 characters
- Stored/model-input excerpt: 40,000 characters after normalization
- Proposals per brief: 12
- Proposed or accepted fact: 280 characters
- Supporting quote: 500 characters
- New scrapes: 3 per Organization per rolling 24 hours
- Proposal attempts: 3 per brief, including the initial attempt

No implementation may silently increase these limits. A future change requires a cost and
security review.

## AI proposal contract

The proposer uses the project's fast model through a plain AI Gateway model string. It uses
structured generation with a strict schema:

- zero to twelve facts;
- fact text: non-empty, at most 280 characters;
- supporting quote: non-empty, at most 500 characters;
- no model-authored URL, source title, capability, action, or publication state.

The system prompt labels the excerpt as untrusted source material, tells the model to ignore
instructions inside it, and asks only for conservative public facts supported verbatim by the
source. Segment and city are context for relevance, not facts the model may assume. The model
receives no tools.

After generation, MORDOMO normalizes whitespace and verifies every supporting quote against
the stored excerpt. One unsupported quote invalidates the complete proposal set. Empty valid
results are allowed and shown as “No grounded facts found,” not converted into hallucinated
fallbacks.

Automated tests mock structured generation and spend no model credit.

## Data model

Every research row carries `organization_id` even when its parent already supplies tenant
scope. Repository predicates use both the row ID and trusted Organization ID.

### `research_briefs`

- `id` UUID primary key
- `organization_id` required foreign key
- `requested_by_clerk_user_id` required text
- `segment` required text
- `city` nullable bounded text
- `locale` required `en | pt`
- `requested_url` required text
- `consent_version` required text
- `consented_at` required timestamp
- `proposal_attempts` required integer, default zero
- `status` required text:
  `retrieving | source_ready | proposing | review_ready | failed | applied`
- `error_code` nullable sanitized text
- `created_at`, `updated_at`

Indexes support Organization recency. A partial unique index allows only one brief in
`retrieving`, `source_ready`, or `proposing` per Organization.

### `research_sources`

- `id` UUID primary key
- `organization_id` required foreign key
- `brief_id` required foreign key
- `url` required normalized text
- `title` required bounded text
- `excerpt` required bounded text
- `provider_request_id` nullable text when the installed contract supplies one
- `provider_credits` nullable integer when the installed contract supplies it
- `retrieved_at` required timestamp

One brief has exactly one source in this increment. The excerpt is retained in MORDOMO because
it is the auditable support for client-reviewed facts; Firecrawl ZDR governs provider retention,
not MORDOMO's tenant-scoped record.

### `research_facts`

- `id` UUID primary key
- `organization_id` required foreign key
- `brief_id` required foreign key
- `source_id` required foreign key
- `proposed_text` required bounded text
- `supporting_quote` required bounded text
- `review_status` required `proposed | accepted | rejected`
- `accepted_text` nullable bounded text
- `reviewed_by_clerk_user_id` nullable text
- `reviewed_at` nullable timestamp
- `created_at` required timestamp

An accepted fact requires accepted text and reviewer metadata. Rejected facts retain the
original proposal and quote for auditability. Editing never overwrites `proposed_text`.

### `data_control_events`

- `id` UUID primary key
- `organization_id` required foreign key
- `actor_clerk_user_id` required text
- `action` required bounded text
- `target_type`, `target_id` required bounded text
- `outcome` required bounded text
- `created_at` required timestamp

Events cover research start, source retrieval outcome, proposal outcome, fact review, and
apply-to-draft. They never contain URLs, excerpts, proposed/accepted text, prompts, errors,
member data, or credentials.

### Profile-version snapshot

The persisted `SecretaryProfile` gains `approvedPublicFacts`, an array of at most twelve
snapshots. Each snapshot contains the accepted text, source title, normalized source URL, and
internal source ID. Existing profiles parse with an empty default during the migration period;
new saves write the field explicitly.

The browser submits accepted fact IDs, not trusted citation text. On Save, the server loads
accepted facts from the active Organization and builds the snapshots. Consequently, research
changes cannot mutate an already saved or published profile version.

## Consent

Consent version `public-research-v1` is required for every new brief, not once per account.
The exact checkbox copy is:

**English**

> I confirm this is a public website that my Organization may research. I approve sending its
> URL to Firecrawl and sending a bounded public excerpt, our segment, optional city, and
> language through MORDOMO's AI Gateway to propose facts. MORDOMO will store the source,
> proposals, and my review decisions. Nothing will enter the secretary profile until I review,
> apply, save, and publish it. I will not submit confidential, personal, authenticated, or
> credential-bearing pages.

**Português**

> Confirmo que este é um site público que minha Organização pode pesquisar. Autorizo o envio
> da URL ao Firecrawl e o envio de um trecho público limitado, do nosso segmento, da cidade
> opcional e do idioma pelo AI Gateway do MORDOMO para propor fatos. O MORDOMO armazenará a
> fonte, as propostas e minhas decisões de revisão. Nada entrará no perfil da secretária até
> que eu revise, aplique, salve e publique. Não enviarei páginas confidenciais, pessoais,
> autenticadas ou que contenham credenciais.

This copy states that:

- the client confirms the website is public and approves its use for this Organization;
- MORDOMO sends the URL to Firecrawl;
- MORDOMO sends a bounded public excerpt, segment, optional city, and language through AI
  Gateway to produce proposals;
- MORDOMO stores the source excerpt, proposals, decisions, and accepted facts;
- nothing is added to the profile until the client reviews and applies it;
- confidential, personal, authenticated, or credential-bearing pages must not be submitted.

The server records the exact consent version and timestamp. A checked box without the expected
server-known version is invalid.

## Studio experience

`OrganizationResearchPanel` renders below the Organization profile form. It is a separate
client component with focused server actions. Personal Studio does not render the component or
receive research props.

### Unavailable

If provisioning, credentials, ZDR verification, or the app-owned enable switch is missing, the
panel explains that public research is not available. Inputs and actions are absent, not merely
visually disabled.

### Ready

The panel inherits segment and response language from the current profile. It collects the
public website, optional city, and explicit consent. Starting research locks the controls
against duplicate submissions.

### Running

The interface distinguishes “Retrieving public source” from “Proposing grounded facts.” It
uses accessible status text and does not invent progress percentages.

### Review

The panel shows the source title and normalized URL, followed by proposal cards. Each card
shows the proposed fact and supporting quote and requires one decision:

- Accept unchanged
- Edit and accept
- Reject

Actions are keyboard accessible and expose pending/error states through live regions. The UI
does not render provider HTML.

### Apply to draft

After all proposals are reviewed, “Apply accepted facts to draft” selects at most twelve
accepted fact IDs in the local editor and marks the profile dirty. The normal Save action
creates the server-materialized version; the normal Publish action remains separate. Starting
new research never erases older research or a saved profile snapshot.

All product copy, consent, validation, stages, review controls, empty states, and errors are
typed in English and Portuguese. Switching UI locale preserves server-side research state.

## State transitions and concurrency

Allowed transitions are explicit:

```text
retrieving → source_ready → proposing → review_ready → applied
     │             │            │
     └─────────────┴────────────┴──→ failed
```

AI retry is allowed only from `source_ready` or from a sanitized proposal failure that retains
a valid source and has fewer than three proposal attempts. It reuses the stored excerpt and
increments `proposal_attempts` before each model call. A new scrape creates a new brief and
requires new consent.

Repository updates include current state in their predicates, so stale actions cannot skip
states. The partial active-brief index is the final duplicate-run guard after the client lock.
Review actions require a `proposed` fact in the trusted Organization; repeated identical
decisions are idempotent, while conflicting stale decisions return a refresh-required error.

## Error handling

Public error codes are finite and bilingual:

- `researchUnavailable`
- `forbidden`
- `invalidInput`
- `unsafeUrl`
- `rateLimited`
- `budgetExhausted`
- `providerUnavailable`
- `zdrRequired`
- `noUsefulContent`
- `proposalFailed`
- `ungroundedProposal`
- `staleResearchState`
- `notFound`

Provider status codes, response bodies, stack traces, URLs, excerpts, prompts, Clerk IDs, and
credentials never reach the client. Server logs use the brief ID, stage, stable error code,
and Organization-scoped operational identifiers only; they omit content and raw provider
errors.

Specific behavior:

- Missing ZDR verification fails before any provider call.
- Invalid URL and consent fail before rate or budget consumption.
- Authorization fails before existence checks.
- Rate and budget denial fail before external work.
- Provider timeout, quota, ZDR conflict, unsafe redirect, or empty content produces a sanitized
  failed brief.
- A saved source survives a later proposal failure, enabling no-rescrape retry.
- Unsupported quotes reject the complete proposal set.
- A model result is not made reviewable if usage-ledger persistence fails.
- Database failure never falls back to browser-only research state.

## Cost controls

- One page per research run and one model call per proposal attempt.
- One active run per Organization.
- At most three new scrapes per Organization per rolling 24 hours.
- At most three deliberate proposal attempts per brief; no automatic retry loop.
- Existing tenant monthly budget and global monthly cap checked before Firecrawl because the
  workflow cannot finish without the model call.
- Existing fast model through AI Gateway.
- Exact input/output tokens and cost recorded as `research.fact_proposal`.
- Provider request/credit metadata recorded only when the installed Firecrawl contract returns
  it; no field is invented from documentation examples.
- The installed Firecrawl plan must also have a provider-side spending limit appropriate to the
  project's $10–50/month target before the app-owned ZDR switch is enabled.

## Verification

### Domain and security tests

- Accept valid public HTTPS URLs; reject credentials, query strings, fragments, non-default
  ports, IP literals, localhost/reserved hosts, overlong paths, and unsafe redirect hosts.
- Parse strict consent, brief states, review decisions, and profile fact snapshots.
- Bound URLs, city, titles, excerpts, facts, and quotes.
- Prove normalized quote matching accepts grounded output and rejects one unsupported fact by
  rejecting the complete set.

### Provider and AI contract tests

- Assert the Firecrawl adapter issues one scrape with ZDR on, cache storage off, and no headers,
  actions, profiles, screenshots, authentication, or extra context.
- Assert Firecrawl receives only the URL.
- Assert AI receives only the bounded excerpt, segment, optional city, locale, and controlled
  instructions.
- Mock structured generation; assert no tools, strict schema, fast model, usage recording on
  success, and output suppression on metering failure.
- Prove failed generation with usable token data still attempts to record the spent usage.

### Repository and action tests

- Migration tests cover columns, foreign keys, indexes, the one-active-brief invariant, and
  review-state constraints.
- Every query/mutation rejects a correct row ID paired with the wrong Organization ID.
- Personal, member, unauthenticated, forged-context, and stale-state calls fail without
  external work.
- Source persistence precedes proposal generation; proposal retry does not call Firecrawl.
- Fact review preserves the proposal and quote while recording accepted edits separately.
- Save materializes only currently accepted fact IDs from the trusted Organization.
- Research changes do not mutate existing profile versions or published behavior.
- Audit events contain metadata only.

### UI tests

- EN/PT unavailable, consent, validation, running stages, review, empty result, retry, apply,
  and error states.
- Organization-only rendering and no Personal research props or actions.
- Duplicate controls lock while pending; stale feedback clears on edit.
- Accept, edit-and-accept, and reject are keyboard accessible.
- Applying facts marks the Studio draft dirty but does not save or publish.
- Locale switching preserves the loaded brief and decisions.

### Integration and manual verification

- Automated tests use fake Firecrawl and mock AI; they never consume external credits.
- Apply the migration and run tenant-isolation checks on a disposable Neon branch, then delete
  it.
- After ZDR is enabled, run exactly one bounded fictional live scrape and confirm the expected
  Firecrawl options, one metered model call, one Organization-scoped brief/source set, and no
  Personal or cross-tenant rows.
- Verify EN/PT browser flow through accept/edit/reject, apply, Save draft, trusted refresh, and
  Publish.
- Run the full suite, typecheck, lint, supported webpack production build, diff checks, and a
  whole-branch security review before handoff.

## Rollout

1. Provision Firecrawl with the current Vercel CLI Marketplace flow and complete any required
   provider dashboard claim.
2. Inspect environment-variable names without printing values, then pull Development env.
3. Request/confirm ZDR for the installed Firecrawl team and perform the bounded fictional ZDR
   smoke.
4. Keep the app-owned research switch off while schema, repositories, adapters, actions, and UI
   are implemented and tested with fakes.
5. Validate the migration on a disposable Neon branch. Do not apply it to Development until
   review passes.
6. Enable the research switch in Development, run one end-to-end fictional smoke, and inspect
   `usage_ledger` plus tenant isolation.
7. Update the public technical brain, commit, push, and hand off for integration review.

## Explicit non-goals

- Personal Secretary research or private-data persistence
- Open-web search, autonomous agents, multi-page crawl, sitemap crawl, or scheduled refresh
- Authenticated pages, cookies, custom headers, browser actions, screenshots, or file uploads
- Provider-side Firecrawl Agent or Extract model calls
- Automatic acceptance, draft save, profile publication, or silent model retraining
- Live secretary test chat, calendar connection, messaging, export, deletion, or key management
- Production or Preview deployment

## Decisions fixed by this design

1. Research is Organization-only and owner/admin-only.
2. Firecrawl ZDR is a hard runtime and rollout gate, not a best-effort option.
3. One approved public page is the entire provider scope.
4. AI proposals use the existing metered AI Gateway path and require source quotes.
5. Human review is mandatory for every proposal.
6. Accepted facts enter only a new explicitly saved profile version and never mutate published
   state automatically.
7. The feature remains disabled until real provisioning and ZDR verification are complete.
