# Handoff — 2026-09-01T03:47:51Z — from codex

## Task

Implement and demonstrate Organization public research through a retention-safe provider while
preserving one-page scope, metering, tenant isolation, and mandatory human review.

## Done

- `2bb0537` — original Organization public-research design.
- `dc65cf5` — original Firecrawl implementation plan.
- `43d941e` — recorded that Firecrawl's free plan cannot satisfy hosted ZDR.
- `3a8a793` — revised and self-reviewed the design around Browserbase strict sessions.
- Browserbase is the live Marketplace's top web-automation result. The approved revision uses
  `recordSession: false`, `logSession: false`, no persistence/context/metadata/proxy/Stagehand,
  deterministic Playwright extraction, and a hard pre-code retention probe.
- Consent advances to `public-research-v2`. The obsolete Firecrawl probe automation was deleted.
  No Browserbase resource or research application code has been created yet.

## Next action

Review and approve the written Browserbase revision. After approval, invoke only
`superpowers:writing-plans` and replace the outdated Firecrawl implementation plan before
provisioning Browserbase or writing application code.

## Files in play

- `docs/superpowers/specs/2026-08-31-organization-public-research-design.md` — revised contract.
- `docs/superpowers/plans/2026-08-31-organization-public-research.md` — outdated Firecrawl plan;
  do not execute it and rewrite it only after written-spec approval.
- `brain/status.md` and `brain/log/decisions/` — current public technical state and decisions.

## Ruled out

- Firecrawl free hosted scraping cannot satisfy its Enterprise-only ZDR gate; no fallback to
  ordinary retention is permitted.
- Vercel Sandbox has a less explicit retrieval-telemetry boundary; direct Function fetch adds
  an unacceptable arbitrary-URL SSRF/DNS-rebinding surface for this beta.
- No open search/crawl, Browserbase agent/Stagehand/model, persistent context, proxy, screenshot,
  authenticated page, custom header, cookie, browser action, or unmetered AI path is allowed.
- `.agents/` and `skills-lock.json` are unrelated user files and remain untracked.

## Verify

Run `if rg -n 'TBD|TODO|FIXME|public-research-v1|RESEARCH_ZDR_VERIFIED' docs/superpowers/specs/2026-08-31-organization-public-research-design.md; then exit 1; fi; git diff --check`.
Good means there are no placeholders, obsolete consent/environment identifiers, or whitespace
errors.
