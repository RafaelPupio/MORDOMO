# Status

**2026-08-18** — Project born. Design brainstormed and approved in conversation.

**2026-08-19** — Spec written and committed
(`docs/superpowers/specs/2026-08-18-churchchatbox-v2-design.md`). Repo scaffolded:
folder, git, brain, CLAUDE.md, public GitHub repo. Implementation decomposed into 4 plans.

**2026-08-20** — **Plan 1 code complete** on branch `feat/plan-1-foundation-chat-slice`
(26 commits, 75 tests green, typecheck + lint clean). Not yet merged, not yet deployed.

## What runs today

The whole chat path exists and is tested end to end against an in-memory Postgres:

- `POST /api/chat` → rate limit → budget gate → conversation ownership → secretary agent
  → streamed reply, with the user turn and the assistant turn persisted.
- The secretary is one tool-using agent: `searchKnowledge`, `getCalendar`,
  `createPrayerRequest`, `escalateToHuman`.
- RAG over pgvector with citation excerpts centred on the matching text.
- Seed corpus for the fictional *Igreja da Colina*: 3 Portuguese documents + 6 events.
  All ten benchmark visitor questions retrieve the right chunk first.
- Cost controls: `usage_ledger` on every LLM/embedding call, per-tenant monthly budget
  (fails closed), atomic per-visitor rate limit, request-size bounds.
- Chat UI at `/chat` with source chips, bilingual disclaimer, and error recovery.

## Blocked — needs Rafael

**Deployment (plan Task 13) cannot proceed without an authenticated Vercel CLI.** The
device-login flow needs a browser and times out unattended. Once Rafael runs
`vercel login`, the remaining steps are: provision Neon via
`vercel integration add neon`, `npm run db:migrate`, `npm run seed` (with the REAL
embedder — never `SEED_FAKE_EMBEDDER`), set `AI_GATEWAY_API_KEY`, `vercel deploy --prod`.

Nothing has been deployed and no cloud resource has been created.

## Next

1. Rafael authenticates Vercel → finish Task 13 (provision, migrate, seed, deploy, verify).
2. Merge Plan 1.
3. Plan 2 — document ingest pipeline (multi-agent extract → verify).

## Open questions

- Final name for the fictional demo church (currently *Igreja da Colina*, disclaimed
  everywhere as fictional).
- Pricing / competitor comparison — deferred until after the build; that analysis is
  business-sensitive and lives in the private V1 repo, not here.
