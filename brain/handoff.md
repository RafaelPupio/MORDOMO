# Handoff — 2026-08-31T19:43:17Z — from codex

## Task

Implement and demonstrate the approved Organization public-research workflow without allowing
Firecrawl or AI providers to retain the submitted source data.

## Done

- `2bb0537` — approved Organization public-research design.
- `dc65cf5` — reviewed 11-task TDD implementation plan plus the internal fact-ID correction
  required for safe profile Save round-trips.
- Firecrawl is provisioned through Vercel Marketplace for Development only; the managed
  `FIRECRAWL_API_KEY` resolves without exposing or committing it.
- The latest bounded `https://example.com` ZDR probe returned HTTP 403 with provider-side ZDR
  not enabled. No scrape content was accepted and no research application code was started.

## Next action

After Firecrawl confirms Zero Data Retention is enabled, rerun the exact bounded probe from
Task 1 of the implementation plan. Proceed with Task 1 dependency installation only when the
result is HTTP 200 with `success: true`.

## Files in play

- `docs/superpowers/specs/2026-08-31-organization-public-research-design.md` — approved contract.
- `docs/superpowers/plans/2026-08-31-organization-public-research.md` — reviewed executable plan.
- `brain/status.md` and `brain/log/decisions/` — current public technical state and decisions.

## Ruled out

- Sending Firecrawl `zeroDataRetention: true` without account-level enablement is insufficient;
  the live API rejects it with HTTP 403.
- No non-ZDR fallback, mock integration, search/crawl mode, authenticated page, custom header,
  cookie, browser action, or unmetered AI path is allowed.
- `.agents/` and `skills-lock.json` are unrelated user files and remain untracked.

## Verify

Run the Task 1 probe in `docs/superpowers/plans/2026-08-31-organization-public-research.md`.
Good means HTTP 200, `success: true`, and no error; HTTP 403 means provider activation remains
the blocker and implementation must not begin.
