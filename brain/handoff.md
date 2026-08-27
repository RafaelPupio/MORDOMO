# Handoff — 2026-08-27T00:00:00Z — from Codex

## Task

Continue the approved invite-only, multi-organization MORDOMO beta after the product rebrand
and five-language public presentation.

## Done

- `04574d1` — public technical design for the SaaS beta.
- `135a38b` — execution plan, corrected for Clerk Hobby's default roles and safe local-env
  ignore rules.
- `de806ac` — Clerk provider, protected-route proxy, and real Development sign-in/sign-up
  shell.
- `2568416` and `29f73d6` — organization tenancy migration, saved profiles, and hardened
  legacy-data foreign-key preservation.
- `77551b1` — typed MORDOMO brand and locale foundation.
- `dae14e9` — shared MORDOMO presentation at `/`, `/pt`, `/es`, `/fr`, and `/de`,
  with localized metadata and a tested 404 boundary.
- Clerk is provisioned and connected to Vercel Development only; Neon remains unchanged.
  No billing or production configuration was added.

## Next action

Perform Task 3 from `docs/superpowers/plans/2026-08-26-ai-secretary-saas-beta.md`: replace
the legacy staff password/cookie boundary with trusted Clerk organization context, and resolve
public chat from a validated organization slug exactly once per request.

## Files in play

- `docs/superpowers/specs/2026-08-25-ai-secretary-saas-beta-design.md` — approved contract.
- `docs/superpowers/plans/2026-08-26-ai-secretary-saas-beta.md` — next task-by-task plan.
- `src/core/organization-context.ts` and `src/core/public-organization.ts` — trusted
  staff/public resolution helpers to add.
- `src/channels/web.ts`, `src/channels/ingest-http.ts`, staff routes/actions, and chat routes —
  callers of the legacy boundary to replace.
- `src/i18n/home-messages.ts` and `src/components/marketing/mordomo-home.tsx` — completed
  public-brand and presentation foundation; use their locale boundary for later interface work.

## Ruled out

- Stripe, checkout, invoices, phone/SMS, outbound delivery, and appointment booking are not
  beta features.
- Clerk paid custom roles are not required: the app retains `owner_clerk_user_id` and uses
  Clerk Hobby's `org:admin` / `org:member` roles.
- Do not apply the migration directly to Development Neon without the disposable-branch check.

## Verify

Run Task 3 ownership and API tests, `npm run typecheck`, and the full suite. Before a live
organization-aware browser test, enable Clerk Organizations with the intended invite-only
membership mode in the Development instance. Apply the migration to a disposable Neon branch
before any Development-database migration.
