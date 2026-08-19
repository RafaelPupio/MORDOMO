# ChurchChatBoxV2 — Design

**Date:** 2026-08-18 (approved in conversation) · **Status:** approved, pre-implementation

## 1. Purpose

A portfolio-grade AI church secretary that demonstrates ten AI capabilities in one
coherent product — AI agents, multi-agent systems, RAG, chatbots, workflow automation,
document processing, knowledge bases, reporting, customer support, and data extraction —
built so it can genuinely become the next generation of ChurchChatBox V1 (a paid,
menu-only WhatsApp secretary SaaS) rather than a throwaway demo.

Two audiences, in priority order:

1. **Portfolio viewers** (recruiters, clients): must be able to click a URL and *use* it
   within seconds, then read the code and find honest engineering.
2. **The future real product**: architecture decisions must not foreclose merging this
   into V1's multi-tenant paid SaaS.

## 2. Product shape

Three surfaces, one fictional tenant:

### 2.1 Member chat (public, no login)

A polished web chat with the "Secretária Virtual" of a fictional Brazilian church
(placeholder name **"Igreja da Colina"** — final name is an open question; the UI always
carries a visible *fictional demo congregation* disclaimer). The bot:

- answers questions grounded in the church's documents, **citing sources** (document +
  excerpt) visibly in the UI;
- answers in **whatever language the visitor writes** (Portuguese-first content, but the
  LLM translates naturally — itself a "V1 couldn't do this" showcase);
- can look up the events calendar, take a **prayer request**, and **escalate to a human**
  (which opens a support ticket);
- streams responses token-by-token.

### 2.2 Staff dashboard (one-click demo login)

English UI (per §7), entered via a "View as staff" demo button (no signup). Sections:

- **Knowledge base** — documents, chunks, ingest status; upload is enabled in demo but
  sandboxed to the demo tenant and rate-limited.
- **Calendar** — events extracted from bulletins by the ingest pipeline, editable.
- **Prayer inbox** — structured prayer requests captured by the bot.
- **Support inbox** — escalated conversations as tickets, with an AI-suggested reply the
  staff member can edit and send (send = visible in the member chat transcript).
- **Reports** — AI-written weekly digests: top questions, unanswered questions, prayer
  themes, usage stats.
- **Usage meter** — tokens and cost this month, per feature, against the tenant budget.

### 2.3 Portfolio shell

An English landing page that explains what the visitor is looking at: the ten
capabilities and where each lives, the architecture diagram, and the "why multi-agent
here but not there" reasoning. Links to the chat, the dashboard, and the repo.

## 3. The ten capabilities → components

| Capability | Implementation |
|---|---|
| AI Chatbots | Member web chat (§2.1) |
| AI Agents | Secretary is a tool-using agent: `searchKnowledge`, `getCalendar`, `createPrayerRequest`, `escalateToHuman` |
| RAG Applications | Chat answers grounded in pgvector retrieval with visible citations |
| AI Knowledge Bases | Postgres + pgvector corpus with staff management UI |
| Document Processing | Upload → parse (PDF/text) → chunk → embed pipeline |
| AI Data Extraction | Extractor agent pulls structured events/schedules/contacts from bulletins into real tables |
| Multi-Agent Systems | Ingest: extractor agent → **verifier agent** (audits extractions before they enter the KB). Weekly report: analyst agent → writer agent |
| AI Workflow Automation | Event-driven: upload triggers ingest→extract→verify→publish. Scheduled: weekly report via Vercel Cron |
| AI Reporting Systems | Weekly digest generation + reports UI |
| AI Customer Support | Escalation → ticket → staff inbox with AI-suggested replies |

## 4. Architecture

### 4.1 Stack

- **Next.js App Router** on Vercel (Fluid Compute, Node runtime — no edge runtime).
- **Neon Postgres + pgvector**, **Drizzle ORM**, migrations in-repo.
- **AI SDK v6 through Vercel AI Gateway**, plain model strings:
  `anthropic/claude-sonnet-5` for the member chat and report writing (quality shows),
  `anthropic/claude-haiku-4-5` for routing, extraction, verification, suggested replies.
  Embeddings via an AI Gateway embedding model (chosen at implementation time; recorded
  in the decisions log).
- **Vercel Blob** for uploaded document files; **Vercel Cron** for schedules (all
  automation is cloud-side — no local schedulers).
- **Vitest** for tests.

### 4.2 Channel-agnostic message core

All conversation flows through a `Channel` adapter interface (deliver message, receive
message, capability flags like streaming/rich-citations). Launch ships the **web
adapter** only; a WhatsApp adapter is a future file, not a rewrite. Core chat logic never
imports anything web-specific.

### 4.3 Orchestration: hybrid (the load-bearing decision)

- **Chat path = one agent.** The secretary is a single tool-using agent. No orchestrator
  in the hot path: visitors judge the product on first-response speed and quality, and a
  single agent with good tools is faster, cheaper, and has fewer failure modes.
- **Back office = multi-agent, async.** Two pipelines where a second agent genuinely
  earns its keep:
  - **Ingest:** parser (deterministic) → extractor agent (structured data out of
    documents) → verifier agent (checks extractions against the source; rejects or
    flags before anything enters the KB or calendar).
  - **Weekly report:** analyst agent (reads the week's conversations/requests, produces
    structured findings) → writer agent (turns findings into the staff-facing digest).
- This asymmetry is documented on the landing page as an engineering argument.

### 4.4 Multi-tenancy

Every table keyed by `church_id` from day one (V1's founding move). The demo church is
tenant #1. A future bring-your-own-church sandbox or the V1 merge adds tenants, not
schema. All queries tenant-scoped at the data-access layer, not ad hoc in routes.

## 5. Data model (sketch)

`churches` · `documents` (blob ref, ingest status) · `chunks` (text, embedding, source
ref) · `events` (extracted, verified flag) · `conversations` · `messages` (role, channel,
citations) · `prayer_requests` · `tickets` (+ suggested reply, status) · `reports` ·
`usage_ledger` (per call: tenant, feature, model, tokens in/out, cost; the basis for
future pricing) · `budgets` (per-tenant monthly caps).

Exact columns are implementation-plan scope; the invariants are: tenant key everywhere,
citations stored with messages, every LLM call metered, extractions carry verification
state.

## 6. Cost & abuse control

- **Per-visitor rate limit** (per IP/session) on chat and uploads.
- **Per-tenant monthly token budget** enforced at the LLM-call layer.
- **Global monthly cap**: when spent, the demo degrades gracefully — chat explains the
  budget is spent and the landing page offers a demo video instead. Never a hard 500.
- **Model tiering** as in §4.1. Target running cost: **$10–50/mo**.

## 7. Language

- Bot: replies in the visitor's language; church content is Portuguese.
- Landing page, dashboard chrome, README, code, comments: English.

## 8. Seed content

A realistic fictional corpus, generated during implementation: monthly bulletin PDFs,
service schedule, ministries (youth/adult groups), event announcements, a statute-like
document, contact/FAQ page. Rich enough that RAG citations, extraction, and reports all
have something real to show. All names fictional; disclaimer everywhere.

## 9. Testing

- Unit tests for the tool implementations, tenant-scoping of the data layer, budget
  enforcement, and the ingest pipeline's state machine (LLM steps mocked).
- Integration tests for the chat route (mocked model) and ingest end-to-end on a fixture
  document.
- A small seed script doubles as the demo fixture and the test fixture.
- Prompt quality is checked manually at launch; automated evals are explicitly later
  scope.

## 10. Out of scope for launch

WhatsApp adapter · self-serve church signup (sandbox) · Stripe billing · pricing page ·
automated evals · broadcasts. Pricing and competitor comparison happen **after** the
build, with real ledger numbers, and that analysis lives in the private V1 repo — not
here.

## 11. Public-repo curation

This repo is public by decision ("show our work without showing too much"). Code, spec,
and the technical brain are public. Secrets, business strategy, V1 internals, and real
personal data never enter this repo. See `CLAUDE.md`.

## 12. Success criteria

1. A stranger can open the URL, ask a question in English or Portuguese, and get a fast,
   cited, correct answer from the demo church's documents.
2. Every one of the ten capabilities is findable in the code and visible in the UI.
3. Uploading a bulletin in the dashboard visibly flows through extract → verify →
   calendar/KB.
4. The weekly report generates from real conversation data on a cron.
5. A month of normal demo traffic stays inside $50 with the caps proven to engage.
