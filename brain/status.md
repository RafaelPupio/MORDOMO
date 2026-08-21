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

**2026-08-20** — **Plan 2 whole-branch review fixes landed** (158 tests green, typecheck
+ lint + build clean). A whole-branch review found the pipeline could silently DELETE
already-verified events (a swallowed extractor or verifier outage was indistinguishable
from "this document has no events", so the delete-then-insert ran anyway) and that the
only shipped upload path had no way to reach the re-ingest behavior the delete-ordering
was designed around — every upload created a new document, so nothing ever replaced.
Both are fixed: `extractEvents`/`verifyEvents` now return a typed outcome that
distinguishes "failed to run" from "genuinely found nothing", `runIngest` skips the
events replace entirely when that distinction says the verdict isn't trustworthy, and
`POST /api/ingest` accepts an optional `documentId` field (checked against the caller's
own church) to express re-ingest. Also fixed: a failed run no longer returns HTTP 201;
omitting `verifierModel` can no longer fall through to a live, billed gateway call;
verifier fan-out is now capped (`MAX_CANDIDATES = 8`) instead of scaling with however many
candidates a document's extractor output claims; `events.verified` is now enforced at
read time in `listUpcomingEvents`, not just written and ignored; the unused
`documents.source_text` column and its writer were dropped rather than wired up, since
nothing reads it and `runIngest` always re-parses the uploaded bytes anyway. Full
findings, decisions, and verification output: `.superpowers/sdd/plan2-final-fixes-report.md`.

**2026-08-20** — **Plan 3 code complete** on branch `feat/plan-3-staff-operations` (211
tests green, typecheck + lint + build clean). Staff operations: password-gated session
login, a guarded `(dashboard)` route group, document upload wired to the same
`runIngest` pipeline `POST /api/ingest` uses, an agenda page showing each verified
event's extraction provenance, prayer-request and support-ticket inboxes with a reply
drafter agent whose output a staff member always edits before sending, and a usage page
(month-to-date cost per feature against the tenant's budget). `POST /api/ingest` now
accepts the same staff session cookie as authorisation; `INGEST_TOKEN` — Plan 2's
explicit placeholder for exactly this — has been removed from the code and from
`.env.example`, per the decision recorded when it was introduced. Not yet merged, not
yet deployed.

**2026-08-20** — **Plan 3 whole-branch review fixes landed** (234 tests green, typecheck
+ lint + build clean). The review's C1 finding was that a staff-sent support reply was
terminal storage: `chat.tsx` minted a brand-new `conversationId` on every page load and
no route ever read `messages` back, so the reply — and the visitor's own history — never
reached anyone, no matter how long they waited or how often they returned. Fixed for
real, not just documented: a new `GET /api/chat/history` route
(`src/channels/web.ts`'s `handleChatHistoryRequest`) resolves the same `ccb_visitor`
cookie the POST path already trusts for ownership, looks up that visitor's conversation
by `(churchId, visitorKey)` (`getConversationByVisitor`, `src/db/repo/chat.ts` — chosen
over a second cookie specifically so ownership has one source of truth, not two that
could drift), and returns its full transcript; the client (`chat.tsx`) now fetches that
on mount and only mints a fresh `conversationId` itself when the server genuinely has
none (first-time visitor). `sendTicketReply`'s write was already in the right shape (a
plain assistant text part) — nothing there needed to change. Also fixed: `uploadDocument`
now wraps its rate-limit and budget DB calls in the same try/catch as everything else
(I2); a new `src/app/staff/(dashboard)/error.tsx` client error boundary catches a DB
failure inside `requireStaffContext()` instead of leaking a raw `NeonDbError` digest
(I3); the reply drafter's conversation excerpt is now bounded by characters
(`MAX_EXCERPT_CHARS = 8,000`), not just message count, closing a path to a
~$0.12-per-call `support.draft` prompt (I4); the staff dashboard's upload form and
`POST /api/ingest` now share one rate-limit bucket and one `INGEST_LIMIT` constant
(`src/core/config.ts`) instead of two 10/hour buckets that together allowed 20 ingest
runs/hour per session (M5); `/staff/uso` now shows the global demo-wide cap alongside
the tenant cap, since a low `DEMO_GLOBAL_MONTHLY_USD_CAP` used to show a green tenant bar
while every AI call was actually being refused (M6); a shared `formatUsd4`
(`src/core/format.ts`) replaced two formatters that had drifted to different precision
(M7); `getSentTicketReply` now checks `isUuid` first like every sibling function in that
file already claimed to (M8); a redundant second default in the global-cap parse was
dropped (M9); the hub's agenda tile shows a real event count instead of "Ver agenda"
(M10); and two slightly different Portuguese "try again" strings were unified (M13).
Full findings, decisions, and verification output:
`.superpowers/sdd/plan3-final-fixes-report.md`.

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

Nothing has been deployed and no cloud resource has been created.

## Next

1. Rafael accepts the Neon Marketplace terms in a browser → finish Task 13 (provision,
   migrate, seed, benchmark against the real embedder, deploy, verify).
2. Merge Plans 1, 2, and 3.
3. Plan 4 — reporting (weekly AI-generated digest) and the portfolio landing page.

## Open questions

- Final name for the fictional demo church (currently *Igreja da Colina*, disclaimed
  everywhere as fictional).
- Pricing / competitor comparison — deferred until after the build; that analysis is
  business-sensitive and lives in the private V1 repo, not here.
