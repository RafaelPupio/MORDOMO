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
- The beta target is invite-only, multi-organization workspaces with a saved secretary
  profile. The planned authorization model uses Clerk's default `org:admin` and
  `org:member` roles; Neon stores the workspace owner's Clerk user ID.
- The existing tenant domain is renamed to organizations in the beta branch. Its migration
  preserves legacy UUIDs and foreign keys in PGlite, but has not been applied to Development
  Neon yet.

## Blocked / next action

1. Before organization-aware flows are tested live, enable Clerk Organizations with the
   intended invite-only membership mode in the Development Clerk instance.
2. Execute Task 3 in `docs/superpowers/plans/2026-08-26-ai-secretary-saas-beta.md`: bind
   authenticated staff and public chat to trusted Clerk organizations.
3. Apply the reviewed organization migration to a disposable Neon branch before it is ever
   applied to the Development database.
4. Localize the visitor chat and staff interface only after those legacy routes are replaced
   by the trusted organization context; the public presentation localization is complete.

## Repository hygiene

- `.env*` and `.vercel` are ignored. Generated Clerk agent-skill files remain uncommitted.
- The public brain contains technical architecture and delivery state only; customer data,
  secrets, pricing strategy, and competitor analysis remain outside this repository.
