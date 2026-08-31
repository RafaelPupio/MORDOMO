# Organization Public Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Organization-only, ZDR-gated Firecrawl workflow that proposes metered, source-grounded public facts for explicit human review and profile-version application.

**Architecture:** A server-only research service resolves the active Clerk Organization, validates one approved public URL, enforces rate/budget gates, scrapes through a narrow Firecrawl adapter, persists a bounded source, and calls AI Gateway for structured fact proposals. Tenant-scoped repositories own state transitions and safe DTOs; a separate bilingual Studio panel reviews facts and passes only accepted fact IDs into the existing explicit Save/Publish flow.

**Tech Stack:** Next.js 16.3 App Router and Server Actions, React 19, TypeScript 5.9, Zod 4, Drizzle ORM 0.45, Neon Postgres/PGlite, AI SDK 7 through Vercel AI Gateway, Firecrawl Node SDK 4.37, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-31-organization-public-research-design.md`

## Global Constraints

- Do not write application code until the Firecrawl ZDR probe in Task 1 returns HTTP 200 with `success: true`. The current verified result is HTTP 403: ZDR is not enabled for the installed team.
- Firecrawl resource `firecrawl-bronze-clock` is installed on the free plan and connected only to Vercel Development for project `mordomo`. Firecrawl's current public documentation classifies hosted scrape ZDR as Enterprise-only, so the installed plan cannot satisfy this gate unless Firecrawl grants an explicit account-level exception or the resource is upgraded.
- The generated credential is the Vercel Config variable `FIRECRAWL_API_KEY`. Never print its value. Resolve it locally with `npx --yes vercel@latest env run -- <command>`.
- Live research requires server-only `RESEARCH_ZDR_VERIFIED === 'true'`; tests set dependencies explicitly and never need a live key.
- Research is Organization-only and limited to the existing Clerk-derived `owner | admin` Studio context. Personal, member, unauthenticated, and forged contexts fail before research lookup or network work.
- One submitted HTTPS page only. No Search, Crawl, Agent, Extract, actions, browser profiles, screenshots, custom headers, cookies, file uploads, TLS bypass, or automatic retries.
- Firecrawl receives only the normalized URL and fixed scrape options: markdown, main content, `zeroDataRetention: true`, `storeInCache: false`.
- Submitted URL maximum 2,048 characters; path 1,024; city 120; source title 200; excerpt 40,000; proposed/accepted fact 280; supporting quote 500; facts per brief 12.
- New scrapes are limited to three per Organization per fixed 24-hour window. Proposal attempts are limited to three per brief, including the initial attempt.
- AI proposals use `FAST_MODEL` (`anthropic/claude-haiku-4-5`) through AI Gateway. Every attempt records exact available input/output usage as `research.fact_proposal`; no output becomes reviewable after a metering write failure.
- AI generation uses current AI SDK 7 `generateText` plus `Output.object`, not deprecated `generateObject` in new code.
- Every client input is Zod-validated. Every Server Action is a reachable untrusted POST and re-authorizes the caller. Client components receive minimal DTOs, never database/provider rows.
- Scraped content is untrusted text. Never render provider HTML, log raw provider errors/content, or give the proposal model tools.
- Human review is mandatory. Applying facts marks the profile dirty; Save creates a new profile version; Publish remains separate.
- Automated tests use fake Firecrawl and mocked AI and spend no credits. A live smoke uses one fictional page only after ZDR is verified.
- Read `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` and `node_modules/next/dist/docs/01-app/02-guides/data-security.md` before editing action or data-access code.
- Preserve unrelated untracked `.agents/` and `skills-lock.json`.

---

### Task 1: Enable ZDR and lock the installed Firecrawl contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: installed Vercel Development resource `firecrawl-bronze-clock` and Config variable `FIRECRAWL_API_KEY`.
- Produces: verified ZDR capability, Development variable `RESEARCH_ZDR_VERIFIED=true`, and dependency `firecrawl@4.37.0`.

- [ ] **Step 1: Request Firecrawl ZDR enablement**

Open the installed resource dashboard:

```bash
npx --yes vercel@latest integration open firecrawl firecrawl-bronze-clock
```

Confirm an Enterprise agreement or explicit account-level exception with Firecrawl support.
Current official documentation identifies hosted scrape ZDR as Enterprise-only; the installed
free Marketplace plan is not sufficient by itself. Do not accept an answer that merely
recommends sending `zeroDataRetention: true`; provider-side enablement is required. Record no
account IDs, support transcript, pricing discussion, or customer-identifying detail in Git.

- [ ] **Step 2: Run the bounded ZDR probe and verify the prerequisite**

Run exactly one scrape of the fictional standards page. This command prints only status and
stable error fields:

```bash
npx --yes vercel@latest env run -- node -e '(async()=>{const response=await fetch("https://api.firecrawl.dev/v2/scrape",{method:"POST",headers:{Authorization:"Bearer "+process.env.FIRECRAWL_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({url:"https://example.com",formats:["markdown"],onlyMainContent:true,storeInCache:false,zeroDataRetention:true})});let body={};try{body=await response.json()}catch{};console.log(JSON.stringify({status:response.status,success:body.success===true,code:body.code??body.errorCode??null,error:typeof body.error==="string"?body.error.slice(0,200):null}))})()'
```

Expected before support enablement: `status:403`, `success:false`, and the ZDR-not-enabled error.
Expected gate to proceed: `status:200`, `success:true`, and no error. Stop if the gate is not
green; do not implement a non-ZDR fallback.

- [ ] **Step 3: Add the app-owned Development gate**

Run:

```bash
printf 'true\n' | npx --yes vercel@latest env add RESEARCH_ZDR_VERIFIED development --non-interactive
npx --yes vercel@latest env pull .env.local --environment=development --yes
```

Expected: Vercel adds `RESEARCH_ZDR_VERIFIED` only to Development. Confirm names without values:

```bash
npx --yes vercel@latest env ls development
rg --pcre2 -o '^[A-Z][A-Z0-9_]*(?==)' .env.local
```

Expected: `FIRECRAWL_API_KEY` appears in Vercel as a Config variable;
`RESEARCH_ZDR_VERIFIED` and `VERCEL_OIDC_TOKEN` support managed local resolution. Do not commit
`.env.local`.

- [ ] **Step 4: Install the provider SDK after provisioning**

Run:

```bash
npm install firecrawl@4.37.0
npm run typecheck
```

Expected: dependency installation succeeds on Node 22+ and the unchanged application still
typechecks.

- [ ] **Step 5: Commit the real provider dependency**

```bash
git add package.json package-lock.json
git commit -m "chore(research): add Firecrawl client"
```

---

### Task 2: Define research contracts, limits, URL safety, and quote grounding

**Files:**
- Create: `src/research/contracts.ts`
- Create: `src/research/url-policy.ts`
- Create: `src/research/source-text.ts`
- Create: `tests/research/contracts.test.ts`
- Create: `tests/research/url-policy.test.ts`
- Create: `tests/research/source-text.test.ts`

**Interfaces:**
- Produces: `publicResearchInputSchema`, `reviewDecisionSchema`, `ResearchErrorCode`, `ResearchStatus`, and public DTO types.
- Produces: `parseApprovedPublicUrl(value: unknown): URL` and `sameApprovedHost(requested: URL, returned: URL): boolean`.
- Produces: `normalizeSourceExcerpt(value: string): string` and `quoteAppearsInSource(source: string, quote: string): boolean`.

- [ ] **Step 1: Write failing contract and policy tests**

Cover the fixed limits and exact safe/unsafe cases:

```ts
it.each([
  'http://example.com',
  'https://user:pass@example.com',
  'https://example.com/?query=private',
  'https://example.com/#fragment',
  'https://127.0.0.1',
  'https://[::1]',
  'https://localhost',
  'https://service.internal',
  'https://example.com:8443',
])('rejects unsafe research URL %s', (value) => {
  expect(() => parseApprovedPublicUrl(value)).toThrow('unsafeUrl');
});

it('accepts one bounded public HTTPS page and a direct www redirect', () => {
  const requested = parseApprovedPublicUrl('https://example.com/about');
  expect(requested.href).toBe('https://example.com/about');
  expect(sameApprovedHost(requested, new URL('https://www.example.com/about'))).toBe(true);
});

it('rejects the entire proposal set when one quote is absent', () => {
  const source = normalizeSourceExcerpt('Fictional Clinic opens Monday.');
  expect(quoteAppearsInSource(source, 'opens Monday')).toBe(true);
  expect(quoteAppearsInSource(source, 'opens Sunday')).toBe(false);
});
```

The contract test must also prove `publicResearchInputSchema` requires
`consentVersion: 'public-research-v1'`, accepts `en | pt`, excludes `personal`, trims city to a
maximum of 120 characters, and does not pass unknown fields through.

- [ ] **Step 2: Run tests to verify the contracts do not exist**

```bash
npm test -- tests/research/contracts.test.ts tests/research/url-policy.test.ts tests/research/source-text.test.ts
```

Expected: FAIL because `@/research/contracts`, `url-policy`, and `source-text` cannot resolve.

- [ ] **Step 3: Implement strict contracts and safe DTOs**

Define these exact public shapes in `src/research/contracts.ts`:

```ts
import { z } from 'zod';
import { betaLocaleSchema } from '@/core/secretary-profile';

export const RESEARCH_CONSENT_VERSION = 'public-research-v1' as const;
export const MAX_RESEARCH_FACTS = 12;
export const organizationResearchSegmentSchema = z.enum([
  'church', 'clinic', 'restaurant', 'real_estate', 'general',
]);
export const researchStatusSchema = z.enum([
  'retrieving', 'source_ready', 'proposing', 'review_ready', 'failed', 'applied',
]);
export type ResearchStatus = z.infer<typeof researchStatusSchema>;

export const researchErrorCodeSchema = z.enum([
  'researchUnavailable', 'forbidden', 'invalidInput', 'unsafeUrl', 'rateLimited',
  'budgetExhausted', 'providerUnavailable', 'zdrRequired', 'noUsefulContent',
  'proposalFailed', 'ungroundedProposal', 'staleResearchState', 'notFound',
]);
export type ResearchErrorCode = z.infer<typeof researchErrorCodeSchema>;

export const publicResearchInputSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  city: z.string().trim().max(120).optional().transform((value) => value || undefined),
  locale: betaLocaleSchema,
  segment: organizationResearchSegmentSchema,
  consentVersion: z.literal(RESEARCH_CONSENT_VERSION),
  consent: z.literal('on'),
}).strict();

export const reviewDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('accept'), factId: z.uuid(), acceptedText: z.string().trim().min(1).max(280) }).strict(),
  z.object({ decision: z.literal('reject'), factId: z.uuid() }).strict(),
]);

export type ResearchFactDTO = {
  id: string;
  proposedText: string;
  supportingQuote: string;
  reviewStatus: 'proposed' | 'accepted' | 'rejected';
  acceptedText?: string;
};

export type OrganizationResearchDTO = {
  available: boolean;
  briefId?: string;
  status?: ResearchStatus;
  error?: ResearchErrorCode;
  source?: { title: string; url: string };
  facts: ResearchFactDTO[];
};
```

Use `node:net` `isIP()` in `url-policy.ts`. Reject all fixed unsafe forms, lowercase the
hostname, remove an explicit `:443`, and accept a returned hostname only when exact or when
removing one leading `www.` makes both equal. Throw `new Error('unsafeUrl')` without including
the submitted value.

In `source-text.ts`, remove C0/C1 control characters except line breaks/tabs, normalize NFC,
collapse horizontal whitespace, cap at 40,000 characters, and use the existing extractor's
Unicode dash/quote/diacritic/whitespace normalization pattern for quote matching. Empty quotes
never match.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
npm test -- tests/research/contracts.test.ts tests/research/url-policy.test.ts tests/research/source-text.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the pure research boundary**

```bash
git add src/research/contracts.ts src/research/url-policy.ts src/research/source-text.ts tests/research
git commit -m "feat(research): add public input contracts"
```

---

### Task 3: Add Organization-scoped research schema and migration

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0007_public_research.sql`
- Modify: `drizzle/meta/0007_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `tests/db/schema.test.ts`
- Create: `tests/db/public-research-schema.test.ts`

**Interfaces:**
- Produces: Drizzle tables `researchBriefs`, `researchSources`, `researchFacts`, and `dataControlEvents`.
- Consumes: `organizations` and existing UUID/timestamp conventions.

- [ ] **Step 1: Write failing migration-backed schema tests**

Use `createTestDb()` and assert inserts plus database constraints:

```ts
it('allows only one active research brief per Organization', async () => {
  const db = await createTestDb();
  const organization = await seedOrganization(db);
  await db.insert(researchBriefs).values(activeBrief(organization.id));
  await expect(db.insert(researchBriefs).values(activeBrief(organization.id))).rejects.toThrow();
});

it('requires accepted facts to carry accepted text and reviewer metadata', async () => {
  const { db, organization, brief, source } = await seededResearch();
  await expect(db.insert(researchFacts).values({
    organizationId: organization.id,
    briefId: brief.id,
    sourceId: source.id,
    proposedText: 'Open Monday.',
    supportingQuote: 'Open Monday.',
    reviewStatus: 'accepted',
  })).rejects.toThrow();
});
```

Also assert every table exposes `organization_id`, brief/source uniqueness, proposal-attempt
default zero, status defaults, and metadata-only audit fields.

- [ ] **Step 2: Run tests to verify schema exports are missing**

```bash
npm test -- tests/db/schema.test.ts tests/db/public-research-schema.test.ts
```

Expected: FAIL because the four table exports do not exist.

- [ ] **Step 3: Define the four Drizzle tables and constraints**

Add `check` to the `drizzle-orm/pg-core` imports. Use exact table names and columns from the
spec. Define these critical database constraints:

```ts
uniqueIndex('research_briefs_one_active_organization')
  .on(t.organizationId)
  .where(sql`${t.status} in ('retrieving', 'source_ready', 'proposing')`)

uniqueIndex('research_sources_one_per_brief').on(t.organizationId, t.briefId)

check('research_facts_review_shape', sql`
  (${t.reviewStatus} = 'proposed' and ${t.acceptedText} is null and ${t.reviewedByClerkUserId} is null and ${t.reviewedAt} is null)
  or (${t.reviewStatus} = 'accepted' and ${t.acceptedText} is not null and ${t.reviewedByClerkUserId} is not null and ${t.reviewedAt} is not null)
  or (${t.reviewStatus} = 'rejected' and ${t.acceptedText} is null and ${t.reviewedByClerkUserId} is not null and ${t.reviewedAt} is not null)
`)
```

Use text/check constraints for finite states because current schema conventions use text rather
than Postgres enums. Add Organization recency indexes and composite indexes beginning with
`organization_id` for every ID lookup.

- [ ] **Step 4: Generate the named Drizzle migration**

```bash
npm run db:generate -- --name public_research
```

Expected: `drizzle/0007_public_research.sql`, `drizzle/meta/0007_snapshot.json`, and journal
entry are generated from `src/db/schema.ts`. Inspect the SQL: no table lacks
`organization_id`; no existing table is dropped or renamed.

- [ ] **Step 5: Run migration-backed tests**

```bash
npm test -- tests/db/schema.test.ts tests/db/public-research-schema.test.ts
npm run typecheck
```

Expected: PASS with PGlite applying migration 0007.

- [ ] **Step 6: Commit the schema boundary**

```bash
git add src/db/schema.ts drizzle tests/db/schema.test.ts tests/db/public-research-schema.test.ts
git commit -m "feat(data): add public research records"
```

---

### Task 4: Implement tenant-scoped research repositories and state transitions

**Files:**
- Create: `src/db/repo/public-research.ts`
- Create: `tests/db/public-research.test.ts`

**Interfaces:**
- Produces: `createResearchBrief`, `saveResearchSource`, `beginProposalAttempt`, `saveProposedFacts`, `failResearchBrief`, `getLatestOrganizationResearchDTO`, `reviewResearchFact`, `listAcceptedResearchFacts`, `markResearchApplied`, and `recordDataControlEvent`.
- Consumes: Task 2 DTO/contracts and Task 3 tables.

- [ ] **Step 1: Write failing repository isolation and transition tests**

Tests must create Organizations A and B and prove a valid row ID cannot cross scope:

```ts
await expect(beginProposalAttempt(db, organizationB.id, briefA.id)).rejects.toThrow('Research brief not found.');
await expect(reviewResearchFact(db, organizationB.id, actorB, {
  factId: factA.id,
  decision: 'accept',
  acceptedText: 'Forged edit',
})).rejects.toThrow('Research fact not found.');
```

Cover `retrieving → source_ready → proposing → review_ready → applied`, failed-source retry,
three-attempt cap, idempotent identical decisions, conflicting stale decisions, safe latest DTO,
and audit events containing no URL/content columns.

- [ ] **Step 2: Run the repository test to verify failure**

```bash
npm test -- tests/db/public-research.test.ts
```

Expected: FAIL because `@/db/repo/public-research` cannot resolve.

- [ ] **Step 3: Implement explicit tenant predicates and compare-and-set transitions**

Every row lookup/update must use both trusted Organization ID and row ID. Export these signatures:

```ts
export async function createResearchBrief(db: Db, input: {
  organizationId: string;
  requestedByClerkUserId: string;
  segment: Exclude<SecretarySegment, 'personal'>;
  city?: string;
  locale: BetaLocale;
  requestedUrl: string;
  consentVersion: typeof RESEARCH_CONSENT_VERSION;
  now?: Date;
}): Promise<ResearchBrief>;

export async function saveResearchSource(db: Db, organizationId: string, briefId: string, input: {
  url: string;
  title: string;
  excerpt: string;
  providerRequestId?: string;
  providerCredits?: number;
  retrievedAt?: Date;
}): Promise<ResearchSource>;

export async function beginProposalAttempt(db: Db, organizationId: string, briefId: string): Promise<{
  brief: ResearchBrief;
  source: ResearchSource;
}>;

export async function saveProposedFacts(db: Db, organizationId: string, briefId: string, sourceId: string, facts: Array<{
  proposedText: string;
  supportingQuote: string;
}>): Promise<void>;
```

Use `where(and(eq(organizationId), eq(id), eq(status)))` on transitions and require returned
rows. `beginProposalAttempt` increments `proposal_attempts` only when it is below three and the
brief has a source. `saveProposedFacts` inserts at most 12 facts and marks `review_ready`; empty
facts still mark `review_ready`.

Return `OrganizationResearchDTO`, not inferred row objects, from the read function. Omit actor,
provider request/credit fields, excerpt, consent timestamp/version, and internal error details.

- [ ] **Step 4: Implement immutable review decisions and metadata-only audit writes**

`reviewResearchFact` accepts only a proposed fact. An identical repeated decision returns the
existing safe fact; an attempt to change an already reviewed fact throws
`staleResearchState`. Preserve `proposed_text` and `supporting_quote`; write edits only to
`accepted_text`.

`recordDataControlEvent` accepts only:

```ts
type DataControlEventInput = {
  organizationId: string;
  actorClerkUserId: string;
  action: 'research.started' | 'research.source' | 'research.proposed' | 'research.reviewed' | 'research.applied';
  targetType: 'research_brief' | 'research_fact' | 'profile_version';
  targetId: string;
  outcome: 'succeeded' | 'failed';
};
```

No function accepts content for an audit write.

- [ ] **Step 5: Run repository and schema tests**

```bash
npm test -- tests/db/public-research.test.ts tests/db/public-research-schema.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit repositories**

```bash
git add src/db/repo/public-research.ts tests/db/public-research.test.ts
git commit -m "feat(data): add research state machine"
```

---

### Task 5: Propose grounded facts through metered AI Gateway output

**Files:**
- Create: `src/research/fact-proposer.ts`
- Create: `tests/research/fact-proposer.test.ts`

**Interfaces:**
- Produces: `proposePublicFacts(deps, input): Promise<PublicFactProposalResult>`.
- Consumes: `FAST_MODEL`, `priceableModelId`, `recordUsage`, Task 2 quote matching, and AI SDK `generateText`/`Output.object`.

- [ ] **Step 1: Write failing proposer tests**

Mock the `generateText` dependency and assert:

```ts
const result = await proposePublicFacts(
  { db, generate: generateTextMock, model: FAST_MODEL },
  {
    organizationId: organization.id,
    briefId,
    locale: 'en',
    segment: 'clinic',
    city: 'Fictional City',
    excerpt: 'Fictional Clinic opens Monday at 09:00.',
  },
);

expect(result).toEqual({
  ok: true,
  facts: [{ proposedText: 'The clinic opens Monday at 09:00.', supportingQuote: 'opens Monday at 09:00' }],
});
expect(await db.select().from(usageLedger)).toMatchObject([
  { feature: 'research.fact_proposal', organizationId: organization.id },
]);
```

Add tests for zero facts, 13 facts rejected by schema, one missing quote rejecting the entire
set, prompt injection text staying inside the untrusted excerpt delimiters, no tools, metering
failure suppressing output, and `NoObjectGeneratedError` usage being recorded when available.

- [ ] **Step 2: Run the proposer test to verify failure**

```bash
npm test -- tests/research/fact-proposer.test.ts
```

Expected: FAIL because `@/research/fact-proposer` cannot resolve.

- [ ] **Step 3: Implement current AI SDK structured output**

Use this strict schema and export contract:

```ts
import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';
import { z } from 'zod';

const publicFactOutputSchema = z.object({
  facts: z.array(z.object({
    proposedText: z.string().trim().min(1).max(280),
    supportingQuote: z.string().trim().min(1).max(500),
  }).strict()).max(12),
}).strict();

export type PublicFactProposalResult =
  | { ok: true; facts: Array<{ proposedText: string; supportingQuote: string }> }
  | { ok: false; error: 'proposalFailed' | 'ungroundedProposal' };

export async function proposePublicFacts(
  deps: { db: Db; model?: LanguageModel; generate?: typeof generateText },
  input: { organizationId: string; briefId: string; locale: BetaLocale; segment: Exclude<SecretarySegment, 'personal'>; city?: string; excerpt: string },
): Promise<PublicFactProposalResult>;
```

Call `generateText` with `model`, `Output.object({ name: 'PublicResearchFacts', schema })`, fixed
system instructions, a prompt containing public context plus `<untrusted_public_source>` tags,
and `maxOutputTokens: 2048`. Do not pass `tools`.

Record usage before returning facts. If `recordUsage` fails, return
`{ ok:false, error:'proposalFailed' }`. On generation errors, inspect only
`NoObjectGeneratedError.usage`; never log generated text, prompt, source, or cause. Attempt to
record available spent usage, then return `proposalFailed`.

After metering, validate every quote with `quoteAppearsInSource`. If one fails, return
`ungroundedProposal` and discard all facts.

- [ ] **Step 4: Run proposer tests and typecheck**

```bash
npm test -- tests/research/fact-proposer.test.ts tests/ai/usage.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the proposer**

```bash
git add src/research/fact-proposer.ts tests/research/fact-proposer.test.ts
git commit -m "feat(research): propose grounded public facts"
```

---

### Task 6: Add the fail-closed Firecrawl adapter

**Files:**
- Create: `src/research/provider.ts`
- Create: `src/research/firecrawl-provider.ts`
- Create: `tests/research/firecrawl-provider.test.ts`

**Interfaces:**
- Produces: `PublicResearchProvider` and `createFirecrawlProvider(config?)`.
- Consumes: `firecrawl@4.37.0`, `FIRECRAWL_API_KEY`, `RESEARCH_ZDR_VERIFIED`, Task 2 URL/source functions.

- [ ] **Step 1: Write failing adapter contract tests**

Inject a fake SDK client and prove exact outbound options:

```ts
expect(scrape).toHaveBeenCalledWith('https://example.com/about', {
  formats: ['markdown'],
  onlyMainContent: true,
  storeInCache: false,
  zeroDataRetention: true,
});
```

Assert no call when key or `RESEARCH_ZDR_VERIFIED=true` is absent, no call for unsafe URL,
safe mapping of 403 ZDR errors, 402/429/timeouts, empty markdown, overlong title/excerpt, and
cross-host returned URLs. Assert returned DTO has only title, normalized URL, bounded excerpt,
and optional request/credit metadata.

- [ ] **Step 2: Run the adapter test to verify failure**

```bash
npm test -- tests/research/firecrawl-provider.test.ts
```

Expected: FAIL because provider modules cannot resolve.

- [ ] **Step 3: Define the provider interface and adapter**

`src/research/provider.ts`:

```ts
export type ScrapedPublicSource = {
  title: string;
  url: string;
  excerpt: string;
  providerRequestId?: string;
  providerCredits?: number;
};

export interface PublicResearchProvider {
  scrapeApprovedPage(url: URL): Promise<ScrapedPublicSource>;
}
```

`firecrawl-provider.ts` must begin with `import 'server-only'`. Accept an injected minimal SDK
client in tests and otherwise instantiate `new Firecrawl({ apiKey })`. Read environment only in
`createFirecrawlProvider`; never at module import. Convert all provider failures into an error
whose public code is `providerUnavailable` or `zdrRequired`, with no raw response attached.

Map SDK output defensively: require string markdown and final source URL; use requested URL when
title is absent; validate final host; normalize/bound content; reject empty content. Capture
request ID or credits only when the actual SDK result contains a finite value.

- [ ] **Step 4: Run adapter and boundary tests**

```bash
npm test -- tests/research/firecrawl-provider.test.ts tests/research/url-policy.test.ts tests/research/source-text.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the adapter**

```bash
git add src/research/provider.ts src/research/firecrawl-provider.ts tests/research/firecrawl-provider.test.ts
git commit -m "feat(research): add ZDR Firecrawl adapter"
```

---

### Task 7: Orchestrate trusted research with rate, budget, retry, and audit gates

**Files:**
- Create: `src/research/service.ts`
- Create: `tests/research/service.test.ts`

**Interfaces:**
- Produces: `startOrganizationResearch`, `retryOrganizationResearchProposal`, `reviewOrganizationResearchFact`, and `getCurrentOrganizationResearch`.
- Consumes: trusted context resolver, Task 2 contracts, Task 4 repository, Task 5 proposer, Task 6 provider, `checkRateLimit`, `checkBudget`, and global cap parsing.

- [ ] **Step 1: Write failing service tests for gate ordering**

Inject spies and prove the exact order: auth → input/feature → rate → budget → create brief →
provider → source save → proposal attempt → proposer → fact save → audit.

Required denials:

```ts
await expect(startOrganizationResearch(deps, {
  kind: 'personal',
  form: validInput,
})).resolves.toEqual({ ok: false, error: 'forbidden' });
expect(provider.scrapeApprovedPage).not.toHaveBeenCalled();
expect(proposePublicFacts).not.toHaveBeenCalled();
```

Also prove member/unauthenticated/forged context, disabled ZDR, invalid URL/consent, rate denial,
budget denial, provider error, proposal error, source reuse on retry, attempt cap, safe logging,
and successful audit events. No returned state may include URL/content/IDs except safe DTO IDs.

- [ ] **Step 2: Run service tests to verify failure**

```bash
npm test -- tests/research/service.test.ts
```

Expected: FAIL because `@/research/service` cannot resolve.

- [ ] **Step 3: Implement server-only orchestration with dependency injection**

Start `service.ts` with `import 'server-only'`. Export:

```ts
export type ResearchServiceDeps = {
  db: Db;
  provider: PublicResearchProvider;
  propose: typeof proposePublicFacts;
  resolveContext: typeof requireStudioWriteContext;
  rateLimit: typeof checkRateLimit;
  budget: typeof checkBudget;
  globalCapUsd: number;
  now?: () => Date;
};

export async function startOrganizationResearch(
  deps: ResearchServiceDeps,
  kindInput: unknown,
  input: unknown,
): Promise<{ ok: true; briefId: string } | { ok: false; error: ResearchErrorCode }>;
```

Parse kind and input before using their values, but resolve authentication before returning an
existence-sensitive result. Require an Organization context. Use key
`research:scrape:${organizationId}`, limit 3, window 86,400 seconds. Check budget with the
existing global-cap parser result before inserting the brief or calling Firecrawl.

Persist each durable state before the next external boundary. On provider failure mark the
brief failed with a stable code. On proposal failure retain the source and mark failed with the
proposal code. Retry requires the same trusted Organization, a stored source, an allowed error
or `source_ready`, and fewer than three attempts; it never invokes the provider.

Log only `{ briefId, stage, code }`. Do not log Organization/Clerk IDs, URL, content, provider
response, prompt, or thrown error objects.

- [ ] **Step 4: Implement review/read wrappers**

`reviewOrganizationResearchFact` re-resolves the active Organization, parses the discriminated
decision, updates only the scoped fact, records metadata-only audit, and returns
`{ ok:true } | { ok:false,error }`.

`getCurrentOrganizationResearch` resolves the current Organization and returns the repository
DTO. It returns `{ available:false, facts:[] }` when the app-owned gate or managed credential is
missing. Personal callers receive no research DTO.

- [ ] **Step 5: Run service and repository tests**

```bash
npm test -- tests/research/service.test.ts tests/db/public-research.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit orchestration**

```bash
git add src/research/service.ts tests/research/service.test.ts
git commit -m "feat(research): orchestrate trusted public research"
```

---

### Task 8: Materialize accepted facts only during explicit profile Save

**Files:**
- Modify: `src/core/secretary-profile.ts`
- Modify: `src/db/repo/secretary-profile-versions.ts`
- Modify: `src/app/[locale]/studio/actions.ts`
- Modify: `tests/core/secretary-profile.test.ts`
- Modify: `tests/db/secretary-profile-versions.test.ts`
- Modify: `tests/app/studio-actions.test.ts`

**Interfaces:**
- Produces: `approvedPublicFactSchema`, `ApprovedPublicFact`, and `approvedPublicFacts` on `SecretaryProfile`.
- Consumes: `listAcceptedResearchFacts(db, organizationId, factIds)` from Task 4.

- [ ] **Step 1: Write failing profile snapshot tests**

Assert old JSON defaults to an empty list, snapshots are strict/bounded, and Save ignores
client-supplied citation text:

```ts
expect(parseSecretaryProfile(profileWithoutFacts).approvedPublicFacts).toEqual([]);

await saveStudioDraft('organization', formWith({
  approvedPublicFactIds: [acceptedFact.id],
  approvedPublicFacts: JSON.stringify([{ text: 'forged', sourceUrl: 'https://evil.invalid' }]),
}));

expect(saveOrganizationSecretaryProfileDraft).toHaveBeenCalledWith(
  expect.anything(),
  'trusted-organization-id',
  expect.objectContaining({
    approvedPublicFacts: [expect.objectContaining({ text: acceptedFact.acceptedText })],
  }),
);
```

Add cross-Organization fact-ID rejection, proposed/rejected fact rejection, duplicate-ID
deduplication preserving submitted order, maximum 12, and published snapshot immutability.

- [ ] **Step 2: Run focused tests to verify failure**

```bash
npm test -- tests/core/secretary-profile.test.ts tests/db/secretary-profile-versions.test.ts tests/app/studio-actions.test.ts
```

Expected: FAIL because `approvedPublicFacts` is not part of the profile and Save does not
materialize IDs.

- [ ] **Step 3: Extend the strict persisted profile**

Add:

```ts
export const approvedPublicFactSchema = z.object({
  researchFactId: z.uuid(),
  sourceId: z.uuid(),
  text: z.string().trim().min(1).max(280),
  sourceTitle: z.string().trim().min(1).max(200),
  sourceUrl: z.string().url().max(2048),
}).strict();

export type ApprovedPublicFact = z.infer<typeof approvedPublicFactSchema>;
```

Add `approvedPublicFacts: z.array(approvedPublicFactSchema).max(12).default([])` before
`.strict()`. Set `approvedPublicFacts: []` in both default profiles. This default is permanent
backward compatibility for stored pre-research versions; every new save serializes the field.

- [ ] **Step 4: Resolve fact IDs server-side during Save**

Read `approvedPublicFactIds` with `formData.getAll`, parse a strict array of at most 12 UUIDs,
deduplicate, and call `listAcceptedResearchFacts` using the Clerk-derived Organization ID.
Build snapshots only from repository results. Reject the entire Save as `invalid` if any ID is
missing, cross-tenant, proposed, or rejected. Never accept `approvedPublicFacts` JSON from the
client.

Keep Personal Save behavior unchanged and browser-local.

- [ ] **Step 5: Run profile/action tests and typecheck**

```bash
npm test -- tests/core/secretary-profile.test.ts tests/db/secretary-profile-versions.test.ts tests/app/studio-actions.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit versioned fact snapshots**

```bash
git add src/core/secretary-profile.ts src/db/repo/secretary-profile-versions.ts src/app/'[locale]'/studio/actions.ts tests/core/secretary-profile.test.ts tests/db/secretary-profile-versions.test.ts tests/app/studio-actions.test.ts
git commit -m "feat(studio): version accepted public facts"
```

---

### Task 9: Add safe research Server Actions and page DTO loading

**Files:**
- Create: `src/app/[locale]/studio/research-actions.ts`
- Modify: `src/app/[locale]/studio/page.tsx`
- Create: `tests/app/research-actions.test.ts`
- Modify: `tests/app/beta-locale-routing.test.ts`
- Modify: `tests/app/studio-no-ai.test.ts`

**Interfaces:**
- Produces: thin actions `startResearchAction`, `retryResearchAction`, and `reviewResearchFactAction`.
- Produces: `research?: OrganizationResearchDTO` prop on Organization Studio only.
- Consumes: Task 7 service and Task 4 safe DTO.

- [ ] **Step 1: Write failing action and route-boundary tests**

Mock the service, not Clerk/database/provider internals. Assert each action passes only parsed
input to the service and returns finite state:

```ts
expect(await startResearchAction({}, validFormData)).toEqual({ ok: 'started' });
expect(JSON.stringify(await startResearchAction({}, invalidFormData))).not.toContain('https://submitted.example/private');
```

Assert Organization page loads a research DTO, Personal page never calls research, unsupported
locales remain 404, and the existing deterministic Studio no-AI test continues to scan only the
deterministic preview/action files—not the separate opt-in research action.

- [ ] **Step 2: Run app tests to verify failure**

```bash
npm test -- tests/app/research-actions.test.ts tests/app/beta-locale-routing.test.ts tests/app/studio-no-ai.test.ts
```

Expected: FAIL because research actions/props do not exist.

- [ ] **Step 3: Implement thin Server Actions**

Begin `research-actions.ts` with `'use server'` and `import 'server-only'`. Export safe state:

```ts
export type ResearchActionState = {
  ok?: 'started' | 'retried' | 'reviewed';
  error?: ResearchErrorCode;
  fieldErrors?: { url?: 'reviewUrl'; city?: 'reviewCity'; consent?: 'consentRequired' };
};
```

Each action delegates to Task 7, maps only stable error codes, and calls `refresh()` from
`next/cache` after successful mutations so the same action response includes fresh RSC data.
Do not return database/provider rows, raw errors, submitted values, Organization/Clerk IDs, or
source excerpts.

- [ ] **Step 4: Load safe Organization research DTO on the page**

After the existing Organization context resolves, load latest profile and safe research DTO in
parallel inside the Server Component. Pass research to `SecretaryStudio`. Personal rendering
does not import or call the research service and passes no research prop.

- [ ] **Step 5: Run app tests and typecheck**

```bash
npm test -- tests/app/research-actions.test.ts tests/app/beta-locale-routing.test.ts tests/app/studio-no-ai.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit safe actions and loading**

```bash
git add src/app/'[locale]'/studio/research-actions.ts src/app/'[locale]'/studio/page.tsx tests/app/research-actions.test.ts tests/app/beta-locale-routing.test.ts tests/app/studio-no-ai.test.ts
git commit -m "feat(research): expose trusted Studio actions"
```

---

### Task 10: Build the bilingual Organization research panel

**Files:**
- Create: `src/components/studio/organization-research-panel.tsx`
- Create: `src/research/copy.ts`
- Create: `src/research/panel-state.ts`
- Modify: `src/components/studio/secretary-studio.tsx`
- Create: `tests/research/copy.test.ts`
- Create: `tests/research/panel-state.test.ts`
- Create: `tests/app/organization-research-panel.test.ts`
- Modify: `tests/app/beta-locale-routing.test.ts`

**Interfaces:**
- Produces: `OrganizationResearchPanel` and pure `ResearchPanelState` reducer/helpers.
- Consumes: Task 2 DTO, Task 8 fact-ID Save fields, and Task 9 actions.

- [ ] **Step 1: Write failing typed-copy and state tests**

Assert complete exact EN/PT keys for unavailable, consent, validation, retrieving, proposing,
review, empty, retry, stale, apply, and error states. Assert state helpers:

```ts
expect(canApplyAcceptedFacts({
  facts: [acceptedFact, rejectedFact],
  pending: false,
})).toBe(true);

expect(reduceResearchPanelState(initial, { type: 'applyAccepted', factIds: [acceptedFact.id] }))
  .toMatchObject({ appliedFactIds: [acceptedFact.id], dirty: true });
```

Assert pending locks duplicate submissions, editing consent/URL clears stale errors, retry does
not clear the stored source, and locale changes do not reset brief/fact IDs.

- [ ] **Step 2: Write failing static-render tests**

Use `renderToStaticMarkup` with action modules mocked. Assert:

- unavailable Organization markup has no URL input or action button;
- ready markup has URL, optional city, exact locale consent, and hidden current segment/locale;
- review markup renders source title/URL as text/link, never excerpt or provider HTML;
- each proposed fact has Accept, Edit and accept, Reject controls with labels;
- applied accepted IDs render as hidden `approvedPublicFactIds` fields in the profile Save form;
- Personal Studio contains no research panel, consent, URL input, or action reference.

- [ ] **Step 3: Run UI tests to verify failure**

```bash
npm test -- tests/research/copy.test.ts tests/research/panel-state.test.ts tests/app/organization-research-panel.test.ts tests/app/beta-locale-routing.test.ts
```

Expected: FAIL because the panel, copy, and state modules do not exist.

- [ ] **Step 4: Implement typed EN/PT copy and pure state**

`copy.ts` exports one `Record<BetaLocale, ResearchCopy>` with no fallback strings. Include the
exact approved `public-research-v1` consent from the spec. `panel-state.ts` owns only client
interaction state: pending action, field edits, selected accepted IDs, dirty flag, and stale
feedback clearing. Server DTO remains the authority for brief/fact state.

- [ ] **Step 5: Implement the isolated panel**

Create a separate bordered card below the profile form. Use `useActionState` for starting and
reviewing, `startTransition` for retry, accessible `aria-live` status, real `<label>` elements,
and field-level errors. Do not nest forms: the existing left column becomes a wrapper
containing the profile `<form>` and a sibling research card.

Render finite states:

```text
unavailable → no inputs
ready       → URL + city + consent
retrieving  → locked “Retrieving public source”
source_ready/proposing → locked “Proposing grounded facts”
review_ready → source + fact decisions + apply
failed with saved source → retry proposal only
failed without source → start a new consented brief
applied → accepted IDs selected; profile remains dirty/unpublished
```

Never render the stored excerpt. The supporting quote is a bounded safe DTO string. External
source links use `target="_blank" rel="noreferrer noopener"`.

- [ ] **Step 6: Integrate fact IDs with the existing profile form**

`SecretaryStudio` owns `appliedResearchFactIds`. Initialize it from the current profile's
`approvedPublicFacts.map(fact => fact.researchFactId)` only for Organization. Applying from the panel
sets the accepted IDs and dispatches the existing `{ type:'edited' }` draft-sync event. Render
one hidden `approvedPublicFactIds` input per ID inside the profile form. Save/publish locking
continues to use the existing reducer.

- [ ] **Step 7: Run focused UI tests and typecheck**

```bash
npm test -- tests/research/copy.test.ts tests/research/panel-state.test.ts tests/app/organization-research-panel.test.ts tests/app/beta-locale-routing.test.ts tests/app/studio-no-ai.test.ts
npm run typecheck
```

Expected: PASS; Personal remains browser-local/no-research and deterministic preview still
makes no AI or Firecrawl call.

- [ ] **Step 8: Commit the bilingual panel**

```bash
git add src/components/studio/organization-research-panel.tsx src/components/studio/secretary-studio.tsx src/research/copy.ts src/research/panel-state.ts tests/research tests/app/organization-research-panel.test.ts tests/app/beta-locale-routing.test.ts
git commit -m "feat(studio): review public research facts"
```

---

### Task 11: Verify database, live ZDR flow, browser experience, and public records

**Files:**
- Modify: `README.md`
- Modify: `brain/status.md`
- Modify: `brain/log/decisions.md`
- Modify: `brain/log/decisions/2026-Q3.md`
- Modify: `brain/handoff.md`

**Interfaces:**
- Consumes: complete Gate 3 implementation.
- Produces: verified Development-only research flow, public-safe evidence, and handoff.

- [ ] **Step 1: Run the complete automated gate**

```bash
npm test -- --reporter=dot --maxWorkers=1
npm run typecheck
npm run lint
npm run build -- --webpack
git diff --check
```

Expected: all tests pass, typecheck/lint/diff are clean, and webpack generates 23 pages with
only the known `unpdf` warning. Default
Turbopack remains non-gating on this host because its child process cannot bind a port.

- [ ] **Step 2: Validate migration on a disposable Neon branch**

Authenticate `neonctl` without printing secrets. Create a uniquely named branch from the
default branch that expires after 24 hours, then capture its direct connection URI only in a
process-local variable:

```bash
RESEARCH_BRANCH="research-verification-$(date -u '+%Y%m%d%H%M%S')"
RESEARCH_EXPIRES_AT="$(date -u -v+1d '+%Y-%m-%dT%H:%M:%SZ')"
npx --yes neonctl@latest branches create --project-id "$NEON_PROJECT_ID" --name "$RESEARCH_BRANCH" --expires-at "$RESEARCH_EXPIRES_AT" --no-secrets
RESEARCH_DATABASE_URL="$(npx --yes neonctl@latest connection-string "$RESEARCH_BRANCH" --project-id "$NEON_PROJECT_ID" --ssl require --no-analytics)"
```

Use the captured direct connection URI only as `DATABASE_URL` for:

```bash
DATABASE_URL="$RESEARCH_DATABASE_URL" npm run db:migrate
```

Verify the four tables, one-active-brief index, accepted-review check, and tenant-isolation SQL.
Delete the disposable branch, clear process-local values, and confirm only the intended
long-lived branch remains:

```bash
npx --yes neonctl@latest branches delete "$RESEARCH_BRANCH" --project-id "$NEON_PROJECT_ID"
unset RESEARCH_DATABASE_URL RESEARCH_EXPIRES_AT RESEARCH_BRANCH
npx --yes neonctl@latest branches list --project-id "$NEON_PROJECT_ID"
```

Never migrate Development Neon during this validation step.

- [ ] **Step 3: Run one bounded fictional live research smoke**

Use an invited fictional Clerk Organization admin, `https://example.com`, no city, English, and
the exact consent. Confirm:

1. Firecrawl succeeds only with ZDR/cache-off options.
2. One source and no more than 12 grounded proposals persist under the active Organization.
3. One `research.fact_proposal` usage row records the model call.
4. Accept/edit/reject works; audit rows contain no URL/content.
5. Apply marks the profile dirty; Save creates a new version; Publish is still separate.
6. Personal context renders no research workflow and has no research rows.
7. A forged Organization/fact ID returns a finite denial and performs no mutation.

- [ ] **Step 4: Open the local app for Rafael's test**

Run the managed-environment dev server:

```bash
npx --yes vercel@latest env run -- npm run dev
```

Open `/en/studio?context=organization` and `/pt/studio?context=organization` in the in-app
browser. Give Rafael this exact test sequence:

```text
1. Sign in and select the fictional Organization.
2. Enter https://example.com and accept the research consent.
3. Start research; observe retrieval then grounded proposal states.
4. Accept one fact, edit-and-accept one if present, and reject another if present.
5. Apply accepted facts; confirm the profile becomes dirty but is not saved.
6. Save draft, wait for trusted refresh, then publish deliberately.
7. Switch to Personal and confirm research is absent.
8. Repeat in Portuguese and confirm exact localized consent/status copy.
```

- [ ] **Step 5: Run whole-branch review before claiming completion**

Review `ed393d1..HEAD` for Critical, Important, and Minor findings with special attention to
Server Action authorization, cross-tenant IDs, raw provider errors, source/prompt injection,
metering failures, stale mutations, and EN/PT completeness. Fix every finding through a
test-first cycle and rerun Step 1.

- [ ] **Step 6: Update public technical records**

Record only publishable facts:

- Firecrawl is Development-only and ZDR-verified; no API key or account/resource IDs.
- Research is one-page, Organization owner/admin only, human-reviewed, and metered.
- Personal research/private data remain inactive.
- Exact verification counts, disposable-branch deletion, and bounded fictional smoke result.
- Remaining next gate is managed key management or optional live Studio testing, subject to a
  separately approved design.

Overwrite `brain/handoff.md` with current task, landed SHAs, one next action, files, ruled-out
paths, and exact verify command.

- [ ] **Step 7: Commit, push, and verify remote head**

```bash
git add README.md brain
git commit -m "docs: verify public research gate"
git push origin codex/ai-secretary-saas-beta
git rev-parse HEAD
git ls-remote --heads origin codex/ai-secretary-saas-beta
git status -sb
```

Expected: local and remote SHA match; only unrelated `.agents/` and `skills-lock.json` remain
untracked.
