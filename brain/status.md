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
- The Personal Secretary beta is limited to encrypted private notes, reminders, and
  calendar metadata. Password storage and WhatsApp-account continuity remain explicitly
  post-beta security work; `docs/product-roadmap.md` records the product backlog.
- The existing tenant domain is renamed to organizations in the beta branch. Its migration
  preserves legacy UUIDs and foreign keys in PGlite, but has not been applied to Development
  Neon yet.

## Blocked / next action

1. Execute `docs/superpowers/plans/2026-08-28-bilingual-studio-foundation.md` for the
   non-sensitive English/Portuguese Studio foundation before feature work on research or
   private data begins.
2. Before organization-aware flows are tested live, enable Clerk Organizations with the
   intended invite-only membership mode in the Development Clerk instance and apply the
   reviewed migration to a disposable Neon branch.
3. Provision and review the public-research integration before enabling research. Choose and
   provision managed key management, then complete its threat model, before any sensitive
   Personal Secretary data is persisted.
4. Build the bilingual (English/Portuguese) Studio and trusted context boundary before
   replacing legacy staff and visitor routes. The public presentation localization is complete.

## Repository hygiene

- `.env*` and `.vercel` are ignored. Generated Clerk agent-skill files remain uncommitted.
- The public brain contains technical architecture and delivery state only; customer data,
  secrets, pricing strategy, and competitor analysis remain outside this repository.
