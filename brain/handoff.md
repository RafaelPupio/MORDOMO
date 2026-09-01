# Handoff — 2026-09-01T04:04:00Z — from codex

## Task

Implement and demonstrate Organization public research through retention-verified Browserbase
while preserving one-page scope, metering, tenant isolation, and mandatory human review.

## Done

- `3a8a793` — revised the approved design from Firecrawl to strict-session Browserbase.
- `1ae9001` — recorded the Browserbase retention gate in the public technical brain.
- `3c7ddc8` — replaced the obsolete Firecrawl plan with the approved 11-task Browserbase plan.
- `00b68c6` — made usage-ledger writes and month boundaries share an explicit UTC clock after a
  real UTC/local month-boundary test failure; 54 files and 429 tests pass and TypeScript passes.
- Browserbase FREE provisioning was attempted for Vercel Development only. Vercel stopped at its
  account-owner Marketplace-terms gate, and the exact approval page is open in Codex.
- No Browserbase resource, credential, retention flag, provider dependency, or research
  application code has been created. The unused Firecrawl resource remains until Browserbase is
  proven safe.

## Next action

Rafael accepts the Browserbase Marketplace terms in the open Vercel page and says `done`. Retry:
`npx --yes vercel@latest integration add browserbase --plan FREE --environment development --no-claim --non-interactive`.
If provisioning succeeds, run Task 1's strict probe and stop unless every retention field matches.

## Files in play

- `docs/superpowers/specs/2026-08-31-organization-public-research-design.md` — approved contract.
- `docs/superpowers/plans/2026-08-31-organization-public-research.md` — executable Browserbase plan.
- `src/ai/usage.ts` and `tests/ai/usage.test.ts` — verified UTC month-boundary repair.
- `brain/status.md` and `brain/log/decisions/2026-Q3.md` — current public technical state.

## Ruled out

- Firecrawl free hosted scraping cannot satisfy its Enterprise-only ZDR gate; no ordinary-retention
  fallback is permitted.
- Application work cannot start before a Browserbase session proves no retained target URL,
  content, logs, or recording and the provider dashboard confirms that result.
- No search/crawl, agent/Stagehand/model, persistent context, proxy, screenshot, authenticated page,
  custom header, cookie, browser action, or unmetered AI path is allowed.
- `.agents/` and `skills-lock.json` are unrelated user files and remain untracked.

## Verify

Run `npm test -- --reporter=dot --maxWorkers=1 && npm run typecheck && git status --short --branch`.
Good means 54 files and 429 tests pass, TypeScript passes, and only `.agents/` plus
`skills-lock.json` remain unrelated and untracked before the Browserbase retry.
