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
- Clerk is provisioned and connected to the Vercel Development environment only; Neon remains
  Development-only. No billing or production configuration was added.

## Next action

Perform Task 2 from `docs/superpowers/plans/2026-08-26-ai-secretary-saas-beta.md`: preserve
the existing data while renaming church tenancy to organization tenancy and adding the saved
secretary-profile model. Begin with the specified failing profile/schema tests.

## Files in play

- `docs/superpowers/specs/2026-08-25-ai-secretary-saas-beta-design.md` — approved contract.
- `docs/superpowers/plans/2026-08-26-ai-secretary-saas-beta.md` — task-by-task execution plan.
- `src/db/schema.ts` and `drizzle/` — tenant schema and additive-safe migration seams.
- `src/db/repo/`, `src/core/channel.ts`, `src/ai/usage.ts`, and `src/core/rate-limit.ts` —
  organization-scoped domain operations to rename coherently.
- `tests/db/schema.test.ts`, `tests/db/repos.test.ts`, and
  `tests/core/organization-profile.test.ts` — Task 2 test-first starting point.

## Ruled out

- Stripe, checkout, invoices, phone/SMS, outbound delivery, and appointment booking are not
  beta features.
- Clerk paid custom roles are not required: the app retains `owner_clerk_user_id` and uses
  Clerk Hobby's `org:admin` / `org:member` roles.

## Verify

Run the focused Task 2 tests, `npm run typecheck`, and the full suite. Verify the migration in
PGlite or an isolated Neon branch before any live organization-aware browser test. Before that
live test, enable Clerk Organizations with the intended invite-only membership mode in the
Development instance.
