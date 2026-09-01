# Status

_Present state only. Git history and [[log/decisions]] hold chronology._

## What runs today

- MORDOMO is the V2 AI-secretary beta: cited RAG chat, document ingest/extraction/verification,
  staff workflows, weekly reports, cost metering, and a multilingual portfolio presentation.
- The Vercel **Development** environment is linked to Neon and has the fictional Igreja da
  Colina corpus seeded. A controlled live chat request retrieved cited source material and
  recorded its cost in `usage_ledger`.
- No Production or Preview environment is configured for the beta, and no billing integration,
  Stripe resource, checkout, or price UI exists.

## MORDOMO beta

- Branch `codex/ai-secretary-saas-beta` contains the approved public technical design,
  Clerk shell, organization-tenancy migration, saved secretary profiles, and MORDOMO rebrand.
  It is isolated from the original V2 worktree; V1 remains untouched and church-focused. Its
  remote repository is `RafaelPupio/MORDOMO`; Vercel infrastructure deliberately remains
  linked as `churchchatboxv2`.
- Clerk is connected to Vercel **Development only** on the free Hobby plan. The project has
  `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in Development; no secret is
  committed.
- Browserbase strict-session extraction is the approved replacement for Firecrawl in the
  Organization public-research design. It requires a fresh Development-only session with
  recording/logging disabled, no persistence or provider AI, one bounded public page, metered
  grounded proposals, and explicit human review before profile Save/Publish. Browserbase is
  provisioned for Development. The bounded API probe created, navigated, and released a session;
  the stored session contained no target hostname and exposed zero logs and zero recordings.
  The dashboard independently showed recording disabled, no pages, no context, and no console,
  network, or browser events. `RESEARCH_RETENTION_VERIFIED` is enabled only in Development and
  the exact Browserbase/Playwright clients are installed. The unused Firecrawl resource,
  integration, managed credential, and stale local credential have been removed. Research
  application code is not active yet.
- Usage-ledger writes now carry an application-owned UTC timestamp, and month aggregation accepts
  an injectable UTC clock. This closes the database-session timezone gap exposed between UTC and
  Cuiabá month boundaries; all 54 test files and 429 tests pass afterward.
- The public presentation is live locally at `/`, `/pt`, `/es`, `/fr`, and `/de`.
  Typed in-repository dictionaries set copy and metadata; invalid locale paths return 404.
- The beta target now spans invite-only organization workspaces and a Personal Secretary
  context. The trial product experience will be English and Portuguese; the five-language
  public presentation remains unchanged. The planned authorization model uses Clerk's
  default `org:admin` and `org:member` roles; Neon stores the workspace owner's Clerk user
  ID.
- The Personal Secretary beta currently persists only one empty Personal context root.
  Profile edits are React/browser memory and intentionally reset on refresh until managed
  key management and its security review are complete. Private notes, reminders, passwords
  or other credentials, calendar connection, research, export, and deletion are inactive.
- The bilingual Studio foundation is verified at `/en/onboarding`, `/pt/onboarding`,
  `/en/studio`, and `/pt/studio`; unsupported beta locales return 404. The deterministic
  preview makes no AI request and owns complete English/Portuguese scenario and rail copy
  without changing its shared capability-safety mapping. Organization editing is locked
  during save, trusted refresh, and publish; those mutations succeed only for the active
  Clerk organization. Exact Portuguese validation and rail rendering are covered.
- The live smoke found exactly one empty Personal root, exactly one published profile for the
  active Organization, no observed Organization with more than one, and a latest
  `usage_ledger` entry predating the smoke. Member-write rejection is automated/auth-layer
  evidence, not a second live account. The disposable smoke branch was deleted and
  Development was left untouched.
- The existing tenant domain is renamed to organizations in the beta branch. Its migration
  preserves legacy UUIDs and foreign keys in PGlite, but has not been applied to Development
  Neon yet.

## Blocked / next action

1. Implement the pure public-research contracts, bounded source normalization, quote grounding,
   and strict public-URL policy through the approved test-first Task 2 plan.
2. Choose and provision managed key management, then complete its threat model and recovery
   review before persisting any sensitive Personal Secretary data.
3. Keep private-data operations (notes, reminders, credentials, calendar connection, export,
   deletion) inactive until those gates produce a separate reviewed implementation plan.

## Repository hygiene

- `.env*` and `.vercel` are ignored. Generated Clerk agent-skill files remain uncommitted.
- The public brain contains technical architecture and delivery state only; customer data,
  secrets, pricing strategy, and competitor analysis remain outside this repository.
