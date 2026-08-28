# Handoff — 2026-08-28T00:00:00Z — from Codex

## Task

Implement the first MORDOMO corporate/personal beta foundation: trusted contexts, EN/PT
Studio, Organization-only versioned profiles, and deterministic tests without AI usage.

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
- `281498d` — active package metadata, public technical docs, and delivery records renamed
  to MORDOMO. The GitHub repository is now `RafaelPupio/MORDOMO`; the Vercel project name was
  intentionally left as deployment infrastructure.
- `af3d825` — review hardening: localized accessible navigation, all localized metadata
  variants, and unsupported-locale metadata regression coverage. The beta branch is pushed.
- Clerk is provisioned and connected to Vercel Development only; Neon remains unchanged.
  No billing or production configuration was added.
- `8bbd00c` — public roadmap and approved Personal Secretary safety boundary.
- `37c37ba` — Corporate + Personal beta design; public sandbox design superseded.
- `docs/superpowers/plans/2026-08-28-bilingual-studio-foundation.md` — reviewed,
  task-by-task implementation plan ready to execute.

## Next action

Execute Task 1 of `docs/superpowers/plans/2026-08-28-bilingual-studio-foundation.md` with
TDD. Before Task 3, configure Clerk Development Organizations as membership-required,
invite-only, with self-service Organization creation disabled.

## Files in play

- `docs/superpowers/specs/2026-08-28-corporate-personal-beta-design.md` — approved product
  boundary and security gates.
- `docs/superpowers/plans/2026-08-28-bilingual-studio-foundation.md` — executable first
  increment; Personal configuration is browser-local only.
- `src/core/organization-profile.ts`, `src/db/schema.ts`, `src/proxy.ts` — current typed
  profile, persistence, and Clerk-route foundations to extend.
- `src/i18n/locales.ts` — five-language public-presentation boundary; do not reuse it as the
  EN/PT beta interface boundary.

## Ruled out

- Stripe, checkout, invoices, phone/SMS, outbound delivery, and appointment booking are not
  beta features.
- Clerk paid custom roles are not required: the app retains `owner_clerk_user_id` and uses
  Clerk Hobby's `org:admin` / `org:member` roles.
- Do not apply the migration directly to Development Neon without the disposable-branch check.
- No raw passwords, private notes, reminders, calendar authorization, research, exports,
  deletion, or WhatsApp recovery in the first increment.
- Do not provision Firecrawl or choose key management until their separate gates are reached.

## Verify

For each task, run its focused Vitest command and `npm run typecheck`. At the end run
`npm test -- --reporter=dot`, `npm run typecheck`, `npm run build`, and `git diff --check`.
