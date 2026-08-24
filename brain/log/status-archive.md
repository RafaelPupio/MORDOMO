# Status archive

The dated build chronology, verbatim from `status.md` where it lived until 2026-08-24.
History, not present state.

---

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
