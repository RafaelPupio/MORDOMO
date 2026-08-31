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
  preview makes no AI request. Organization save, trusted refresh, and publish succeed only
  for the active Clerk organization; exact Portuguese validation is covered.
- The live smoke found exactly one empty Personal root, per-organization published counts of
  one, and a latest `usage_ledger` entry predating the smoke. Member-write rejection is
  automated/auth-layer evidence, not a second live account. The disposable smoke branch was
  deleted and Development was left untouched.
- The existing tenant domain is renamed to organizations in the beta branch. Its migration
  preserves legacy UUIDs and foreign keys in PGlite, but has not been applied to Development
  Neon yet.

## Blocked / next action

1. Provision and review the public-research integration before enabling research; Firecrawl
   retention and consent terms must be approved first.
2. Choose and provision managed key management, then complete its threat model and recovery
   review before persisting any sensitive Personal Secretary data.
3. Keep private-data operations (notes, reminders, credentials, calendar connection, export,
   deletion) inactive until those gates produce a separate reviewed implementation plan.

## Repository hygiene

- `.env*` and `.vercel` are ignored. Generated Clerk agent-skill files remain uncommitted.
- The public brain contains technical architecture and delivery state only; customer data,
  secrets, pricing strategy, and competitor analysis remain outside this repository.
