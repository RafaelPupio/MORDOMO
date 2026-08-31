# Status

_Present state only. The dated build chronology is in [[log/status-archive]]._

> Naming: the project is **MORDOMO** everywhere — folder, GitHub repo
> (`RafaelPupio/MORDOMO`), package name, docs, and UI. Bare "ChurchChatBox" in these
> notes always means **V1**, the separate private WhatsApp product this one succeeds.
> The Vercel project is renamed to `mordomo` too, but its auto-assigned domain is still
> `churchchatboxv2.vercel.app`: `mordomo.vercel.app` is already taken by an unrelated app
> ("Mordomo — Controle Financeiro Inteligente") that is not ours. A custom domain is the
> only way to get a MORDOMO-branded URL.

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

## Blocked — needs Rafael

**Deployment (plan Task 13) is blocked on Neon Marketplace terms-of-service acceptance,
which needs a browser.** Provisioning the production database via
`vercel integration add neon` surfaces a Marketplace terms screen that only renders in an
interactive browser session, so it cannot be driven unattended from the CLI. Once Rafael
accepts those terms, the remaining steps are: `npm run db:migrate`, `npm run seed` (with
the REAL embedder — never `SEED_FAKE_EMBEDDER`), set `AI_GATEWAY_API_KEY`,
`STAFF_PASSWORD`, and `STAFF_SESSION_SECRET`, `BENCHMARK_REAL_EMBEDDER=1 npm run
benchmark:retrieval` against that real seed to confirm retrieval quality holds with real
embeddings (not just the offline HashEmbedder number), `vercel deploy --prod`.

**Correction (2026-08-31):** this note previously claimed nothing had been deployed.
That was wrong. The GitHub integration has been auto-building every push since
2026-08-20 — roughly twenty preview and production deployments exist. They are not a
working demo: deployment protection (`ssoProtection: all_except_custom_domains`) makes
every deployment URL redirect to a Vercel login, and with no database provisioned every
DB-backed route would fail anyway. What is true is that no Neon database exists and no
publicly reachable demo exists.

## Next

All four product plans are merged to `main` (318 tests, typecheck and lint clean). The
only remaining work is deployment, and it is blocked on Rafael — see above.

1. Rafael accepts the Neon Marketplace terms in a browser → finish deployment (provision,
   migrate, seed, benchmark against the real embedder, deploy, verify).
2. After the first real deploy: re-run the retrieval benchmark against the real embedder
   and record the number here, replacing the offline-only caveat above.

## Open questions

- Final name for the fictional demo church (currently *Igreja da Colina*, disclaimed
  everywhere as fictional).
- Pricing / competitor comparison — deferred until after the build; that analysis is
  business-sensitive and lives in the private V1 repo, not here.
