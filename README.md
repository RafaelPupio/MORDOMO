# ChurchChatBoxV2

An AI church secretary for a fictional Brazilian church, **Igreja da Colina**. This is a
portfolio project, not a real product: the church, its documents, staff, and members are
all invented, and no real data appears anywhere in this repo or its seed corpus.

## Status

**Plans 1–4 (foundation + chat, document ingest, staff operations, reporting + portfolio shell) are code-complete.
Nothing is deployed yet.** There is no live demo URL — deployment is blocked on accepting
Neon's Marketplace terms of service, a step that only renders in an interactive browser
session and so cannot be driven from an unattended CLI. Everything below is built and
covered by an automated test suite (`npm test`), but none of it has run in production. A
URL will be added here once it exists.

## What works today

- Streaming web chat backed by a single tool-using agent — the "Secretária Virtual" —
  with four tools: `searchKnowledge` (grounded, cited answers), `getCalendar`,
  `createPrayerRequest`, `escalateToHuman`.
- Retrieval-augmented generation over pgvector, with source citations (document +
  excerpt) shown in the UI.
- A document ingest pipeline (upload → parse → chunk → embed → extract → verify →
  publish): an extractor agent proposes calendar events from an uploaded document, and a
  separate verifier agent — a distinct model call, prompted to disprove each candidate —
  audits every one against its source before it can reach the calendar.
- A password-gated staff area (`/staff`), covering:
  - knowledge-base management — document list, upload, and per-document ingest status;
  - an agenda that shows each verified event alongside its extraction provenance (the
    source quote and the verifier's note);
  - prayer-request and support-ticket inboxes with AI-suggested draft replies that a
    staff member edits and sends — nothing goes out unread;
  - a usage page showing month-to-date AI cost per feature against the tenant's budget.
- Per-tenant usage metering (`usage_ledger`) and a monthly budget cap that fails closed,
  enforced on every AI-touching path — visitor chat and authenticated staff actions
  alike.
- Per-visitor rate limiting, request-size bounds, and conversation ownership tied to a
  server-minted cookie — never the client's IP or anything the client supplies.
- A visitor's conversation persists across page loads: `GET /api/chat/history`, guarded
  by that same cookie, resumes their own thread (and only their own) instead of starting
  a fresh, empty one every time — which is also how a staff-sent support reply (above)
  actually reaches the visitor who asked.
- A committed, runnable retrieval benchmark (`npm run benchmark:retrieval`) scoring ten
  Portuguese visitor questions against the seed corpus.
- Weekly AI reporting: a bounded activity gatherer feeds an analyst agent that returns
  structured findings; a separate writer agent turns only those findings, aggregate counts,
  and the week's metered AI cost into a Portuguese staff digest. Prayer themes use a closed vocabulary, so names
  and diagnoses are structurally inexpressible in that sensitive part of the report.
  Reports can be run on demand in `/staff/relatorios` or every Monday by the authenticated
  Vercel Cron route.

## Architecture, briefly

**Next.js App Router · Neon Postgres + pgvector · Drizzle ORM · AI SDK v6 via the Vercel
AI Gateway · Vitest.**

The chat path runs on **one** tool-using agent, not a multi-agent pipeline. That's
deliberate: visitors judge the product on first-response speed and quality, and a single
agent with good tools is faster, cheaper, and has fewer failure modes than an
orchestrator sitting in front of every message. Multi-agent orchestration is reserved
for the async back-office pipelines that actually need a second pass — document ingest
(extractor → verifier) and weekly reporting (analyst → writer) — where nobody is waiting
on the reply in real time.

## Not built yet

Deliberately out of scope for now: multiple staff accounts, roles, and password reset; a
staff audit log; a WhatsApp channel adapter for visitors; self-serve church signup; and
billing. A sent support reply appears in the visitor's own
chat transcript the next time they open `/chat` — the visitor's conversation is now
resumed across page loads (a returning visitor's `ccb_visitor` cookie is matched back to
their conversation; see `GET /api/chat/history`) instead of a fresh, empty one starting
every time — but it is still not *pushed*: nothing is sent by email or WhatsApp, so a
visitor who never returns to the chat never sees the reply. A document's original file is
not stored — only its extracted text and chunks are — so there is no document download.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in the values — see that file for what's needed
npm run db:migrate
npm run seed
npm run dev
```

`npm run seed` uses the real Vercel AI Gateway embedder by default. **Never set
`SEED_FAKE_EMBEDDER` when seeding anything but a local or test database** — it swaps in a
deterministic bag-of-words hash instead of real embeddings, so retrieval over that data
looks plausible while being wrong.

Tests run against an in-memory Postgres (PGlite + pgvector) and need no external
services or API keys: `npm test`.

## Design & plan

- Design spec: `docs/superpowers/specs/2026-08-18-churchchatbox-v2-design.md`
- Implementation plans: `docs/superpowers/plans/2026-08-19-plan-1-foundation-chat-slice.md`,
  `docs/superpowers/plans/2026-08-20-plan-2-ingest-pipeline.md`,
  `docs/superpowers/plans/2026-08-20-plan-3-staff-operations.md`,
  `docs/superpowers/plans/2026-08-20-plan-4-reporting.md`
- Running technical log: `brain/status.md`, `brain/log/decisions.md`

## Language

The bot answers in whatever language the visitor writes in. Church content (the seed
corpus) is Portuguese; all code, comments, and docs are English.
