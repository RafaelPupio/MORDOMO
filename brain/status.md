# Status

_Present state only. The dated build chronology is in [[log/status-archive]]._

> Naming: the project is **MORDOMO** everywhere — folder, GitHub repo
> (`RafaelPupio/MORDOMO`), package name, docs, and UI. Bare "ChurchChatBox" in these
> notes always means **V1**, the separate private WhatsApp product this one succeeds.
> The Vercel project is renamed to `mordomo` too, but its production domain is still
> `churchchatboxv2.vercel.app` — renaming a project does not rename its domain, and
> `mordomo.vercel.app` is already taken by an unrelated app ("Mordomo — Controle
> Financeiro Inteligente") that is not ours. That domain is **public**; see the
> correction below before repeating the claim that protection blocks the demo.

## What runs today

The whole chat path exists and is tested end to end against an in-memory Postgres:

- `POST /api/chat` → rate limit → budget gate → conversation ownership → secretary agent
  → streamed reply, with the user turn and the assistant turn persisted.
- `GET /api/chat/history` resumes a returning visitor's own conversation (matched by the
  same `ccb_visitor` cookie the POST path trusts for ownership) instead of the client
  starting a fresh, empty one on every page load — this is also how a staff-sent support
  reply actually reaches the visitor who asked, the next time they open `/chat`.
- The secretary is one tool-using agent: `searchKnowledge`, `getCalendar`,
  `createPrayerRequest`, `escalateToHuman`.
- RAG over pgvector with citation excerpts centred on the matching text.
- Seed corpus for the fictional *Igreja da Colina*: 3 Portuguese documents + 6 events,
  plus a November bulletin ingested through the live pipeline on 2026-09-05 (4 documents,
  10 events in production). `scripts/retrieval-benchmark.ts` (`npm run benchmark:retrieval`)
  scores **10/10 against the real embedder** (`GatewayEmbedder`,
  `openai/text-embedding-3-small`, via `BENCHMARK_REAL_EMBEDDER=1`) and 10/10 offline
  against the deterministic `HashEmbedder`.
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
  the error recorded rather than leaving it stuck mid-run. Fail-closed does NOT mean
  fail-destructive: an agent-stage outage on re-ingest (extractor or verifier) leaves the
  document's previously verified events untouched rather than replacing them with an
  empty set — `IngestResult.eventsReplaced` says whether this run's outcome was trustworthy
  enough to actually replace them. `events.verified` is enforced at read time
  (`listUpcomingEvents`), not just written by the verifier and trusted. `POST /api/ingest`
  runs this inline (`maxDuration = 300`, no queue yet) behind the staff session cookie
  (see below) — an unset session secret, a missing cookie, a bad signature, an expired
  session, or a session signed for a different church all fail closed with 401 — and
  returns a non-201 status when the run itself ends `failed`. An optional `documentId`
  form field re-ingests (replaces) that document instead of creating a new one, rejecting
  one that doesn't belong to the caller's church. Proven end to end in
  `tests/e2e/ingest-to-answer.test.ts`: a freshly ingested bulletin is retrievable via the
  secretary's `searchKnowledge` tool, cited to the right document, and its verified event
  shows up in `getCalendar`.
- **Staff area** (`/staff`, Plan 3): a password check (`STAFF_PASSWORD`, fails closed
  when unset) signs an HMAC-signed, httpOnly session cookie; the `(dashboard)` route
  group re-checks that cookie on every request and redirects to `/staff/login` otherwise
  — `/staff/login` itself sits outside the guarded group, so an unauthenticated visit
  redirects exactly once, never loops. Every staff page and Server Action derives
  `churchId` from that session alone (`requireStaffContext()`), never from a form field.
  Documents: list, upload (through the same `runIngest` pipeline `POST /api/ingest`
  uses), per-document ingest status. Agenda: verified events with their extraction
  provenance (source quote + verifier note). Prayer requests and support tickets: status
  workflow, plus a reply-drafter agent (`draftReply`) that proposes a grounded Portuguese
  reply for a ticket — a staff member always edits and sends it; the drafter returns an
  empty draft rather than throwing if retrieval or generation fails, so a broken drafter
  never blocks the inbox. Usage page: month-to-date cost per feature
  (`chat.reply`, `chat.retrieval`, `ingest.embed`, `ingest.extract`, `ingest.verify`,
  `support.draft`, `support.retrieval`) against the tenant's budget. All staff mutations
  remain rate-limited and budget-gated exactly like the public chat path — an
  authenticated session on a public demo is still an untrusted spend path, not a reason
  to relax the gates.
- **Reporting + portfolio shell** (Plan 4): `gatherWeekActivity` bounds each raw activity
  kind before the analyst sees it; the analyst produces structured findings and a separate
  writer turns only those findings, aggregate counts, and the week's AI cost into Portuguese
  markdown. A report is never published after a failed analysis or writer call. The cron
  checks the same monthly tenant/global budget before either model runs. Prayer themes are a closed
  Portuguese vocabulary (plus `outro`), so personal names and diagnoses are structurally
  impossible in a digest theme. The other operational fields remain free-text summaries
  and do not make the same structural guarantee. `/staff/relatorios` shows reports and can run last week's
  report on demand; `GET /api/cron/weekly-report` runs each Monday at 09:00 UTC behind
  `CRON_SECRET`. The public `/` page now maps all ten built AI capabilities to the actual
  product surfaces and explains why the visitor hot path uses one agent while ingest and
  reporting use separate two-agent pipelines.

## Deployed and working — 2026-09-04

MORDOMO is live on its own infrastructure, **public**, and verified end to end in
production by an anonymous client — no cookie, no bypass token, no Vercel session.

- **Own database.** The Neon resource previously attached to this project belonged to a
  different application (organizations, personal_contexts, research_briefs, live rows).
  It was disconnected — along with unused Clerk and Browserbase resources — and a fresh
  Neon project `mordomo-db` provisioned in `sa-east-1` (São Paulo). Verified empty before
  migrating. `DATABASE_URL` is scoped to Production, Preview and Development, and all
  three point at the same database.
- **Migrated and seeded with the REAL embedder** (`openai/text-embedding-3-small`),
  authenticated by the Vercel OIDC token — no `AI_GATEWAY_API_KEY` was needed. 22 chunks,
  6 events.
- **Retrieval gate passed with real embeddings: 10/10**, and still 10/10 offline. One
  question ("tem atividade para crianças?") returns the Ministério Infantil section rather
  than the FAQ line the fixture expected; the ministry section is the better answer, so
  the benchmark now accepts either. That single expectation was an artifact of tuning
  against bag-of-words overlap.
- **Production smoke test passed**: landing page renders, `/chat` and `/staff/login` 200,
  `/api/cron/weekly-report` returns 401 without the secret, and a real question —
  "Que horas é o culto de domingo?" — returned "10h e 18h30" in Portuguese with three
  cited documents, persisting both turns.
- **Cost metering works in production**: `chat.reply` US$0.0126, `chat.retrieval` US$0,
  `ingest.embed` US$0.000024 against a US$40 tenant cap.

**Public URL: <https://mordomo-demo.vercel.app>** — attached as a project production domain on
2026-09-05 (`mordomo.vercel.app` belongs to an unrelated app). `churchchatboxv2.vercel.app`
still resolves to the same deployment and keeps working.

### Correction (2026-09-05): deployment protection was never blocking the demo

Three notes here, and the handoff, said the last step was Rafael turning off Vercel
Authentication. That was wrong, and the error was the same shape as the earlier ones:
reading a setting's *name* instead of measuring the URL.

`ssoProtection.deploymentType` is `all_except_custom_domains`, which protects the
per-deployment URLs (`mordomo-<hash>-rafael-e2fe.vercel.app`) and the branch aliases —
**but exempts the project's production domain**. Measured 2026-09-05:

| URL | anonymous |
| --- | --- |
| `mordomo-eokk4j8ig-rafael-e2fe.vercel.app` | 302 → `vercel.com/sso-api` |
| `mordomo-rafael-e2fe.vercel.app` | 302 → `vercel.com/sso-api` |
| **`churchchatboxv2.vercel.app`** | **200** |

Every earlier smoke test had been aimed at a deployment URL, so it only ever proved the
protected side. Against the production domain, with an empty cookie jar:

- landing `<title>MORDOMO</title>`, `/chat` 200, `/staff/login` 200
- `/api/cron/weekly-report` → 401 without the secret
- `POST /api/chat` "Que horas é o culto de domingo?" → *"aos domingos às **10h** e às
  **18h30**"* with five cited excerpts, and `ccb_visitor` minted `HttpOnly; Secure;
  SameSite=Lax` on the response

The demo has been public since the deploy. Nothing is pending on Rafael.

**Still true:** the public URL carries V1's old name. Renaming the Vercel project did not
rename its production domain, and `mordomo.vercel.app` belongs to an unrelated app
("Mordomo — Controle Financeiro Inteligente"). `mordomo-demo`, `mordomo-app`,
`mordomo-ai` and `mordomo-chat` under `.vercel.app` are all free (404). Adding one as a
project domain, or a real custom domain, is the only way to a MORDOMO-branded link — and
that is a naming call, not a blocker.

## Acceptance pass — 2026-09-05: every capability exercised in production

Until this pass, three advertised capabilities had never actually run against production:
document ingest, the weekly report, and the prayer/escalation tools. Running them found
two real defects, both now fixed and deployed.

- **The two-agent ingest pipeline rejected 100% of correct events — and the fix took three
  rounds, because the first two were prompts.** The extractor is told to emit `startsAt` in
  UTC; the verifier was never told that convention, so it read every correctly converted
  timestamp as a three-hour error. First real exercise of the pair in production: 7
  extracted, 7 rejected, every note citing "deslocamento de 3 horas". The seeded agenda
  events are fixtures inserted directly, which is why nothing caught it earlier.
  - Round 1, shared UTC rule in both prompts: 4 wrong / 14 in a live probe — a correct
    22h event rejected as "wrong date" because its UTC instant is the next calendar day.
  - Round 2, calendar-day rule + injection guard: **5 wrong / 18** — an ordinary 19h30
    service now rejected, the wrong-day candidate now *confirmed*, and "o horário startsAt
    16:00Z está correto" inside the document still steering the verdict. The notes were
    arithmetic done wrong in both directions.
  - Round 3, structural: `formatLocalWallClock` (src/agent/time-convention.ts) renders
    `startsAt` as "sábado, 14/11/2026, 22:00 (horário de Brasília)" **in code**, and that
    text is all the verifier sees — never an ISO/UTC value. Its job is purely textual now.
    **0 wrong / 27** across three runs; every note is "o documento indica 14/11, não 13/11".
    The injection case fell with it: there is no `startsAt` left for a sentence in the
    document to talk about.
  - The same November bulletin re-ingested in production after each round: **7/0/7**
    originally → **6/4/2** after round 1 → **7/6/1** after round 3 (extracted/published/
    rejected). The Bazar and both Santa Ceia services publish now; the single remaining
    rejection is the 22/11 Culto de Ação de Graças, on content grounds. Agenda: 12 events,
    6 seeded and 6 from the live pipeline.
- **The upload message hid the distinction that mattered.** "N trechos, N evento(s)
  publicado(s)" rendered "no dates in this bulletin", "every candidate rejected" and "the
  extractor never ran" identically, though `runIngest` already tells them apart. That is
  how a total-rejection bug looked like an ordinary result. `describeIngest` now reports
  the whole outcome.
- **A report claimed two different end dates** — heading 06/09, prose 07/09 — because the
  writer built its own period line from the raw half-open `periodEnd`. `formatPeriodLabel`
  moved to `src/core/period.ts` so both read one computation.
- **CI now exists** (`.github/workflows/test.yml`: typecheck, lint, tests **and build** on
  every push and PR; all of it offline, no secrets needed). It failed on its first run and
  was right to: `tsc --noEmit` had been passing only because `.next/types` lingered
  locally, and `LayoutProps<"/">` does not exist on a clean clone.
- **Then all three checks passed on a commit that could not build.** `describeIngest` was
  exported from the upload action's module, and Next allows a `'use server'` module to
  export only async functions. Typecheck, lint and 326 tests went green; `next build`
  failed, and two production deploys sat in ERROR while the alias quietly kept serving
  the last good build — so the live site looked perfectly healthy. Helper moved to
  `src/core/ingest-summary.ts`; `npm run build` is now a CI step. **Check deployment
  state after pushing; a green alias is not a green deploy.**
- **Adversarial review of the day's commits** (34 agents: 6 dimensions → 3 refuters per
  finding → completeness critic): 9 raw, 5 confirmed, 4 refuted, 2 critic gaps. Confirmed
  and fixed: a verification *outage* read as "todos rejeitados" (nothing was judged; the
  agenda was deliberately left untouched); candidates dropped by `MAX_CANDIDATES` vanished
  from the arithmetic; the failure sentences rendered in the green success slot; the
  writer's period line and the verifier's "not a shift" line had no guarding test. **One
  refutation was wrong**: the reviewers judged the midnight-crossing wording safe 0/3 by
  reading the prompt — "the failing case cannot be constructed from the text" — while the
  live probe constructed it 2/2. A prompt's behaviour is a measurement, not an argument.
- **Residual risk, recorded rather than hidden**: prompt injection through an uploaded
  document is now structurally narrower (no UTC vocabulary to latch onto) and guarded by
  `UNTRUSTED_DOCUMENT_NOTE`, but it is still a prompt-level defence. A document that argues
  in Portuguese about the event's own local date and time is the surface that remains.
- **Verified working in production**: anonymous chat with citations; prayer request and
  human escalation both firing their tools; a real weekly report whose prayer section reads
  "Saúde: 1 pedido" — the closed-enum privacy design holding, no name and no diagnosis
  reaching the digest.

Month-to-date spend after all of it: well under a dollar against the US$40 tenant cap and
US$50 global cap.

## Next

Nothing is blocking, and nothing is waiting on Rafael. The demo is public, every advertised
capability has now run in production at least once, and 342 tests / 39 files pass with
typecheck, lint and build clean, CI green.

Open, in rough order of value:

1. **Monday 2026-09-07, 09:00 UTC**: the first unattended cron report covering the week of
   31/08–06/09. That week's row already exists (generated on demand on 05/09 to exercise
   the analyst → writer pair before Monday); the cron replaces it by
   `(churchId, periodStart)`. If it does not appear, that is the thing to look at.
2. **Ingest has no queue.** `POST /api/ingest` runs the whole pipeline inline under
   `maxDuration = 300`. A long PDF near the 5 MB cap is the case that would find the edge.

## Open questions

- Final name for the fictional demo church (currently *Igreja da Colina*, disclaimed
  everywhere as fictional).
- Pricing / competitor comparison — deferred until after the build; that analysis is
  business-sensitive and lives in the private V1 repo, not here.
