# Status

_Present state only. Git history and [[log/decisions]] hold chronology._

## What runs today

- The original V2 church-secretary demo remains functional on `main`: cited RAG chat,
  document ingest/extraction/verification, password-gated staff operations, weekly reports,
  cost metering, and the public AI-systems portfolio page.
- The Vercel **Development** environment is linked to Neon and has the fictional Igreja da
  Colina corpus seeded. A controlled live chat request retrieved cited source material and
  recorded its cost in `usage_ledger`.
- No Production or Preview environment is configured for the new SaaS work, and no billing
  integration, Stripe resource, checkout, or price UI exists.

## AI Secretary SaaS beta

- Branch `codex/ai-secretary-saas-beta` contains the approved public technical design
  (`04574d1`) and execution plan (`135a38b`). It is isolated from the original V2 worktree.
- Clerk is connected to Vercel **Development only** on the free Hobby plan. The project has
  `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in Development; no secret is
  committed.
- The beta target is invite-only, multi-organization workspaces with a saved secretary
  profile and five interface locales: English, Portuguese, Spanish, French, and German.
- The planned authorization model uses Clerk's default `org:admin` and `org:member` roles;
  Neon stores the workspace owner's Clerk user ID. This avoids paid custom-role features.
- Task 1 is complete: the root app is wrapped in Clerk, protected beta routes pass through
  Clerk's proxy, and real Clerk sign-in/sign-up routes run locally at Development scope.

## Blocked / next action

1. Before organization-aware flows are tested live, enable Clerk Organizations with the
   intended invite-only membership mode in the Development Clerk instance.
2. Execute Task 2 in
   `docs/superpowers/plans/2026-08-26-ai-secretary-saas-beta.md`: migrate persistent
   church tenancy to organization tenancy and add the saved secretary profile.

## Repository hygiene

- `.env*` and `.vercel` are ignored. Generated Clerk agent-skill files remain uncommitted.
- The public brain contains technical architecture and delivery state only; customer data,
  secrets, pricing strategy, and competitor analysis remain outside this repository.
