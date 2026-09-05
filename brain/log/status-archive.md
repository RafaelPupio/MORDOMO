# Status archive

The dated build chronology, verbatim from `status.md` where it lived until 2026-08-24.
History, not present state.

---

**2026-08-18** — Project born. Design brainstormed and approved in conversation.

**2026-08-19** — Spec written and committed
(`docs/superpowers/specs/2026-08-18-mordomo-design.md`). Repo scaffolded:
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


## Archived 2026-09-05 — superseded by the deployed-and-verified state in [[../status]]

Three blocks below described a project that was not yet deployed, plus a blocker that
was resolved on 2026-09-04. They are kept because the corrections they record are the
project's most repeated lesson: cloud state is not repo state, and a setting's name is
not a measurement.

## ⚠ Blocker found 2026-09-04: the attached Neon database is NOT ours

`vercel integration list` shows a Neon resource on the `mordomo` project, and the earlier
note treated that as "the database is provisioned". Inspecting it before running any
migration showed it belongs to a **different application** and holds that app's live data:

    organizations (2)  organization_profiles (1)  personal_contexts (1)
    data_control_events (19)  secretary_profile_versions (5)
    research_briefs (3)  research_facts (9)  research_sources (3)
    + documents (3), chunks (22), messages (16), usage_ledger (16), events (6) …

It is neither MORDOMO's nor ChurchChatBox V1's — V1's migrations create `church`,
`admin_user`, `menu_item` (singular), a different schema entirely. Two proofs it is not
ours: `churches` **does not exist** (every MORDOMO table FKs to it), and the drizzle
journal shows **8 applied migrations** where MORDOMO has 5.

**Why this mattered:** the documented next step was `npm run db:migrate`. That would have
run MORDOMO's migrations into a live foreign database whose `documents`, `chunks`,
`messages`, `events`, `conversations`, `tickets`, `budgets`, `rate_limits` and
`usage_ledger` names collide with ours but whose shapes differ — a partial, failed
migration against someone else's data.

**Do not migrate or seed until MORDOMO has its own Neon database.** `.env.local` has been
reset to a placeholder so nothing in this repo can reach the foreign one.

Deciding what to do is Rafael's: provision a fresh Neon project for MORDOMO and connect
it, and disconnect the foreign resource from the `mordomo` Vercel project.

## Deployment state (checked live 2026-08-31, not inferred)

The long-standing "blocked on Neon Marketplace terms" note was **stale**. A Neon database
(`neon-cordovan-canvas`) and a Clerk instance (`clerk-pink-button`) are both provisioned
and attached to the Vercel project `mordomo` — the terms were accepted around 2026-08-25.
Clerk is not used by this codebase (staff auth is our own signed cookie) and is unused
cruft worth removing.

What actually stands between here and a working public demo:

1. **Every Neon variable is scoped to `Development` only.** `vercel env ls production`
   returns nothing, so a production build has no `DATABASE_URL`.
2. **None of the app's own secrets exist in any environment**: `AI_GATEWAY_API_KEY`,
   `STAFF_PASSWORD`, `STAFF_SESSION_SECRET`, `CRON_SECRET`,
   `DEMO_GLOBAL_MONTHLY_USD_CAP`.
3. **Migrations and seed have not been run against that database** (unverified — checking
   needs the connection string).
4. **Deployment protection is on** (`ssoProtection: all_except_custom_domains`), so every
   URL redirects to a Vercel login. Turn this off LAST — an open URL is a spend path, so
   it should only open once the budget caps are live.
5. **Retrieval benchmark still offline-only** — `BENCHMARK_REAL_EMBEDDER=1 npm run
   benchmark:retrieval` against the real seed is the launch gate.

## Previously blocked — now resolved

~~Deployment is blocked on Neon Marketplace terms-of-service acceptance.~~
**Resolved 2026-08-25** — the terms were accepted and the database provisioned. Kept here
because the reasoning still applies to any future marketplace integration: Provisioning the production database via
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


## Archived 2026-09-05 (evening) — the deploy and acceptance narratives, superseded by the present-tense block in [[../status]]

These three sections are the full record of 2026-09-04/05: the first deploy, the morning
acceptance pass (verifier, CI, build), and the afternoon pass (PDF, draft, skew protection).
The decisions log carries the reasoning; this keeps the measurements.

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

## Second acceptance pass — 2026-09-05 (afternoon): the parts nobody had run

"Every capability has run in production" was still not true at noon: the support **reply
drafter** had never fired, no staff reply had ever reached a visitor, and no **PDF** had
ever been ingested. Running those found four more defects, all fixed, all deployed.

- **PDF ingest had never worked in production.** A 638-byte one-page PDF failed on Vercel
  with "Cannot transfer object of unsupported type" while the same bytes parsed locally in
  7 ms. pdf.js posts the document to its worker with `structuredClone(…, { transfer:
  [bytes.buffer] })`, and whatever ArrayBuffer backs `File.arrayBuffer()` on Vercel's
  runtime is not transferable — Node's own Buffer pool and WebAssembly memory behave the
  same way and reproduce the message verbatim offline. And when a buffer *is* transferable
  the transfer **detaches** it: both upload paths parse the same bytes twice, and the
  second parse got an empty array (byteLength 0 — also reproduced offline).
  `parseDocument` now hands pdf.js a private copy. After the fix: one-page PDF 13 s; a
  **964 KB, 235-page PDF: 553 chunks in 31 s** through a single `embedMany` call, well
  inside `maxDuration`. So the "long PDF" edge case has a measured answer: not the limit.
- **A chase that was an artifact.** After the fix, the *form* path kept failing with the
  same message while `/api/ingest` succeeded — for 40 minutes it looked like a second bug
  specific to Server Actions. It was **Vercel skew protection** (`skewProtectionMaxAge`
  43200): Server Actions carry the deployment id of the page that issued them, and my tab
  had been loaded before the fix deployed, so every action went to `0c138bf` while plain
  `fetch` went to the alias. The logs' `deploymentId` settled it. **Rule: reload the page
  after every deploy before testing a Server Action, or read which deployment served the
  request.** Local `next start` had already shown the bundle was fine.
- **The AI draft never reached the reply textarea.** First run of "Sugerir resposta":
  `support.draft` metered, label and five sources rendered, textarea empty. The effect
  queued `setReplyText(cur => cur === lastDraftRef.current ? draft : cur)` and *then*
  advanced the ref; React runs the updater lazily, so it compared against the new draft and
  never changed the text. A reviewer-driven replacement of the `key={draft}` remount that
  had worked. `syncDraft` captures the previous draft first; its test uses a deferred fake
  setter that mimics React's timing, and the original ordering fails it 2/4. Verified in
  production afterwards: a 350-character grounded draft, sent, ticket **Respondido**.
- **The extractor failed outright on a long document.** 235 pages, 40k chars after
  truncation, ~133 dated lines: the model emitted events until `maxOutputTokens` cut the
  JSON mid-string ("Unterminated string in JSON at position 11544"), `generateObject`
  threw, and the document published with **zero** events instead of its first eight. The
  prompt now asks for at most `MAX_EXTRACTED_EVENTS` (the soonest on or after the reference
  date), and `MAX_CANDIDATES` derives from the same constant. Same slice, live: 8
  candidates, ~5 s, 2/2.
- **Debuggability.** Next collapses an inspected Error's frames into "at ignore-listed
  frames" when none is ours, which is every async library failure. The ingest failure log
  now carries the stack as a plain string.
- **Vercel Sensitive env vars** (`STAFF_PASSWORD`, `STAFF_SESSION_SECRET`, `CRON_SECRET`)
  come out of `vercel env pull` as the literal `[SENSITIVE]`. Nothing was inconsistent;
  the pulled file simply never contains them.

Test documents from this pass (ten, including the 553-chunk one) were deleted from
production afterwards; the four real documents remain and the retrieval gate is still
**10/10** against the real embedder.

