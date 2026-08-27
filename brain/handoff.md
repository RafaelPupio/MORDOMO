# Handoff — 2026-08-27T00:00:00Z — from Codex

## Task

Build the approved invite-only, multi-organization AI Secretary beta with Clerk development
authentication, saved profiles, and five localized interfaces.

## Done

- `04574d1` — public technical design for the SaaS beta.
- `135a38b` — execution plan, corrected for Clerk Hobby's default roles, and safe local-env
  ignore rules.
- `de806ac` — Clerk provider, protected-route proxy, and real Development sign-in/sign-up
  shell. Focused auth tests, TypeScript, production build, and the full test suite passed.
- `2568416` — safe organization-tenancy migration, repository rename, and persisted,
  validated secretary profiles. Full tests, TypeScript, production build, and a legacy-data
  PGlite migration regression passed; Development Neon remains unchanged.
- `29f73d6` — review hardening for that migration: complete child-FK preservation regression,
  renamed database constraints, matching Drizzle snapshot, and organization terminology cleanup.
- Clerk is provisioned and connected to the Vercel Development environment only; Neon remains
  Development-only. No billing or production configuration was added.

## Next action

Perform Task 3 from `docs/superpowers/plans/2026-08-26-ai-secretary-saas-beta.md`: replace
the legacy staff password/cookie boundary with trusted Clerk organization context, and resolve
public chat from a validated organization slug exactly once per request.

## Files in play

- `docs/superpowers/specs/2026-08-25-ai-secretary-saas-beta-design.md` — approved contract.
- `docs/superpowers/plans/2026-08-26-ai-secretary-saas-beta.md` — task-by-task execution plan.
- `src/core/organization-context.ts` and `src/core/public-organization.ts` — Task 3 trusted
  staff/public resolution helpers to add.
- `src/channels/web.ts`, `src/channels/ingest-http.ts`, staff routes/actions, and chat routes —
  current callers of the legacy boundary to replace.
- `src/db/schema.ts`, `drizzle/0005_rename_churches_to_organizations.sql`, and
  `src/db/repo/organization-profiles.ts` — completed tenancy/profile foundation.

## Ruled out

- Stripe, checkout, invoices, phone/SMS, outbound delivery, and appointment booking are not
  beta features.
- Clerk paid custom roles are not required: the app retains `owner_clerk_user_id` and uses
  Clerk Hobby's `org:admin` / `org:member` roles.

## Verify

Run Task 3 ownership and API tests, `npm run typecheck`, and the full suite. Before a live
organization-aware browser test, enable Clerk Organizations with the intended invite-only
membership mode in the Development instance. Apply the migration to a disposable Neon branch
before any Development-database migration.
