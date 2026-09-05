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

## Deployed — present state

**Public URL: <https://mordomo-demo.vercel.app>** (project production domain, SSO-exempt;
`churchchatboxv2.vercel.app` still resolves to the same deployment). Own Neon database
`mordomo-db` in `sa-east-1`; `DATABASE_URL` scoped to Production/Preview/Development, all
three pointing at it. Real embedder (`openai/text-embedding-3-small`) authenticated by the
Vercel OIDC token; no gateway key needed. 350 tests / 41 files, typecheck, lint and build
clean; CI (typecheck + lint + tests + build) green on every push.

**Verified in production, by running it, as of 2026-09-05 evening:**

- Anonymous chat with citations from the public URL (no cookie, no bypass).
- Document ingest through the staff form, **Markdown and PDF**: a 964 KB, 235-page PDF
  parses, chunks (553) and embeds in 31 s; the extractor returns a bounded list of at most
  8 events; the verifier is shown local wall-clock text and never UTC (0/27 wrong in a live
  probe). The November bulletin: 7 extracted, 6 published, 1 rejected on content grounds.
- Prayer request and human escalation firing their tools; a staff **AI draft** landing in
  the reply box, sent, and **reaching the visitor's own conversation** via
  `GET /api/chat/history` — and nobody else's (no cookie → empty).
- A real weekly report (analyst → writer) whose prayer section reads "Saúde: 1 pedido" —
  the closed-enum privacy design holding.
- Budget metering on every call; month-to-date spend a few cents against US$40 / US$50 caps.
- Retrieval gate **10/10** against the real embedder, re-run after the test corpus was removed.

**Standing rules learned the hard way** (details in [[log/decisions]], measurements in
[[log/status-archive]]):

- Cloud state is not repo state; a setting's *name* is not a measurement; a green alias is
  not a green deploy — ask Vercel for deployment *state*.
- The first production run of anything is a test. Seeded fixtures that resemble output are
  worse than an empty table.
- When two agents must agree on a fact (a time-zone conversion), compute it once in code
  and hand both the result; asking each to derive it gives correlated errors.
- **After a deploy, reload the page before testing a Server Action** — skew protection
  (12 h) pins actions to the deployment the page was loaded from. Forty minutes were spent
  on a "second bug" that was this.
- `vercel env pull` writes `[SENSITIVE]` for Sensitive vars (`STAFF_PASSWORD`,
  `STAFF_SESSION_SECRET`, `CRON_SECRET`); the pulled file never contains them.
- Residual risk, recorded rather than hidden: prompt injection through an uploaded
  document is narrower now (no UTC vocabulary to latch onto) but still a prompt-level
  defence for text that argues about an event's own local date and time.

## Next

Nothing is blocking, and nothing is waiting on Rafael. The demo is public, every advertised
capability has now run in production at least once, and 350 tests / 41 files pass with
typecheck, lint and build clean, CI green.

Open, in rough order of value:

1. **Monday 2026-09-07, 09:00 UTC**: the first unattended cron report covering the week of
   31/08–06/09. That week's row already exists (generated on demand on 05/09 to exercise
   the analyst → writer pair before Monday); the cron replaces it by
   `(churchId, periodStart)`. If it does not appear, that is the thing to look at.
2. **Ingest has no queue.** `POST /api/ingest` runs the whole pipeline inline under
   `maxDuration = 300`. Measured: a 964 KB, 235-page PDF takes 31 s end to end, so the
   5 MB cap is not near the time limit for text PDFs; a scanned/image PDF is untested.

## Open questions

- Final name for the fictional demo church (currently *Igreja da Colina*, disclaimed
  everywhere as fictional).
- Pricing / competitor comparison — deferred until after the build; that analysis is
  business-sensitive and lives in the private V1 repo, not here.
