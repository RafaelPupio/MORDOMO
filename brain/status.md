# Status

**2026-08-18** — Project born. Design brainstormed and approved in conversation.

**2026-08-19** — Spec written and committed
(`docs/superpowers/specs/2026-08-18-churchchatbox-v2-design.md`). Repo scaffolded:
folder, git, brain, CLAUDE.md, public GitHub repo. Implementation decomposed into 4 plans.

**2026-08-20** — **Plan 1 code complete** on branch `feat/plan-1-foundation-chat-slice`
(26 commits, 75 tests green, typecheck + lint clean). Not yet merged, not yet deployed.

**2026-08-20** — **Plan 2 code complete** on branch `feat/plan-2-ingest-pipeline` (135
tests green, typecheck + lint clean). Document ingest pipeline — parse → chunk → embed →
extract → verify → publish — proven end to end: a freshly ingested bulletin becomes
retrievable and cited by the secretary, and its verified event lands on the calendar the
agent reads (`tests/e2e/ingest-to-answer.test.ts`). Not yet merged, not yet deployed.

## What runs today

The whole chat path exists and is tested end to end against an in-memory Postgres:

- `POST /api/chat` → rate limit → budget gate → conversation ownership → secretary agent
  → streamed reply, with the user turn and the assistant turn persisted.
- The secretary is one tool-using agent: `searchKnowledge`, `getCalendar`,
  `createPrayerRequest`, `escalateToHuman`.
- RAG over pgvector with citation excerpts centred on the matching text.
- Seed corpus for the fictional *Igreja da Colina*: 3 Portuguese documents + 6 events.
  `scripts/retrieval-benchmark.ts` (`npm run benchmark:retrieval`) scores 10/10 on the ten
  benchmark visitor questions — but only measured offline, against the deterministic
  bag-of-words `HashEmbedder`. It has NOT yet been run against the real embedder
  (`GatewayEmbedder`, `openai/text-embedding-3-small`) that will actually serve visitors.
  Re-running it with `BENCHMARK_REAL_EMBEDDER=1` against the real production seed is a gate
  before the demo is public.
- Cost controls: `usage_ledger` on every LLM/embedding call, per-tenant monthly budget
  (fails closed), atomic per-visitor rate limit, request-size bounds.
- Chat UI at `/chat` with source chips, bilingual disclaimer, and error recovery.
- **Document ingest pipeline** (`runIngest`, Plan 2): upload → parse → chunk → embed →
  extract → verify → publish, driving each document through an explicit `ingest_status`
  state machine (`uploaded → parsing → extracting → verifying → published`, `failed`
  reachable from any non-terminal state, `published` terminal so a served document is
  never silently pulled back into the pipeline). An extractor agent pulls candidate
  calendar events out of the document text; a separate verifier agent — a distinct model
  call, prompted to disprove each candidate rather than confirm it — audits every
  candidate against the source before anything reaches the calendar. The pipeline fails
  closed throughout: a verification-call outage rejects that candidate instead of
  publishing it unchecked, and any unhandled failure parks the document at `failed` with
  the error recorded rather than leaving it stuck mid-run. `POST /api/ingest` runs this
  inline (`maxDuration = 300`, no queue yet) behind a placeholder bearer-token gate
  (`Authorization: Bearer <INGEST_TOKEN>`) that fails closed — an unset or empty token
  rejects every request rather than admitting one. **`INGEST_TOKEN` must be set in
  production** before this endpoint is usable there. Proven end to end in
  `tests/e2e/ingest-to-answer.test.ts`: a freshly ingested bulletin is retrievable via the
  secretary's `searchKnowledge` tool, cited to the right document, and its verified event
  shows up in `getCalendar`.

## Blocked — needs Rafael

**Deployment (plan Task 13) is blocked on Neon Marketplace terms-of-service acceptance,
which needs a browser.** Provisioning the production database via
`vercel integration add neon` surfaces a Marketplace terms screen that only renders in an
interactive browser session, so it cannot be driven unattended from the CLI. Once Rafael
accepts those terms, the remaining steps are: `npm run db:migrate`, `npm run seed` (with
the REAL embedder — never `SEED_FAKE_EMBEDDER`), set `AI_GATEWAY_API_KEY` and
`INGEST_TOKEN`, `BENCHMARK_REAL_EMBEDDER=1 npm run benchmark:retrieval` against that real
seed to confirm retrieval quality holds with real embeddings (not just the offline
HashEmbedder number), `vercel deploy --prod`.

Nothing has been deployed and no cloud resource has been created.

## Next

1. Rafael accepts the Neon Marketplace terms in a browser → finish Task 13 (provision,
   migrate, seed, benchmark against the real embedder, deploy, verify).
2. Merge Plan 1 and Plan 2.
3. Plan 3 — staff operations (dashboard, real staff auth retiring `INGEST_TOKEN`).

## Open questions

- Final name for the fictional demo church (currently *Igreja da Colina*, disclaimed
  everywhere as fictional).
- Pricing / competitor comparison — deferred until after the build; that analysis is
  business-sensitive and lives in the private V1 repo, not here.
