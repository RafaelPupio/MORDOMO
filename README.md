# MORDOMO

MORDOMO is a multilingual AI secretary for organizations. It began as a public portfolio
prototype for the fictional Brazilian church **Igreja da Colina**, which remains an invented
demo preset. No real organization or personal data appears in this repository or seed corpus.

## Status

The original portfolio application is deployed at
[`mordomo-demo.vercel.app`](https://mordomo-demo.vercel.app). The invite-only SaaS beta adds
Clerk authentication, isolated organization tenancy, secretary profiles, a bilingual Studio,
and reviewed public research. Beta services remain Development-only; this is not presented as
a public production SaaS.

## What works today

- Streaming multilingual chat with grounded knowledge search and citations, calendar lookup,
  prayer-request creation, human escalation, and cookie-owned conversation history.
- Document ingest from upload through parsing, chunking, embeddings, event extraction, an
  independent verifier, and publication.
- A staff area for documents, agenda provenance, prayer requests, support tickets, editable AI
  drafts, weekly reports, metered usage, and retention visibility.
- Tenant and global AI budgets, per-visitor rate limits, request bounds, and usage-ledger cost
  accounting on every AI path.
- Weekly analyst → writer reporting over bounded activity, with a closed vocabulary for prayer
  themes so names and diagnoses are structurally inexpressible there.
- Five-language public presentation (English, Portuguese, Spanish, French, German).
- EN/PT organization onboarding and Studio with typed profiles, deterministic preview, draft
  save, trusted refresh, versioned snapshots, and explicit publish.
- A browser-local Personal preview that intentionally persists no profile edits or sensitive
  material.
- Organization-only public research over one consented HTTPS page via strict Browserbase
  sessions: bounded visible text, grounded proposals, usage metering, mandatory human review,
  explicit save, and separate publish.
- Optional retention for eligible resolved records. It is inert unless `RETENTION_DAYS` is set
  to a valid 30–3650 day value.

## Architecture

**Next.js App Router · Neon Postgres + pgvector · Drizzle ORM · Clerk · AI SDK v6 through
Vercel AI Gateway · Browserbase · Vitest.**

The visitor path uses one tool-calling agent for speed and reliability. Multi-agent work is
reserved for asynchronous flows where a second pass adds audit value: extractor → verifier for
document events and analyst → writer for weekly reports.

## Deliberate limits

Billing, self-serve production onboarding, WhatsApp delivery, pushed staff replies, staff audit
logs, and original-file download are not built. Personal private notes, credentials, reminders,
calendar integration, export, deletion, and persistent profile editing require separate vault,
key-management, recovery, and security reviews.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in the documented values
npm run db:migrate
npm run seed
npm run dev
```

Never point `db:migrate` or `seed` at a database whose ownership and migration history have not
been verified. `npm run seed` uses real AI Gateway embeddings by default;
`SEED_FAKE_EMBEDDER` is only for local or test databases.

Tests use in-memory PGlite + pgvector and need no external services:

```bash
npm test
npm run typecheck
```

## Design and plans

- Foundation: `docs/superpowers/specs/2026-08-18-mordomo-design.md`
- Active beta: `docs/superpowers/specs/2026-08-25-ai-secretary-saas-beta-design.md`
- Corporate + Personal addendum:
  `docs/superpowers/specs/2026-08-28-corporate-personal-beta-design.md`
- Public research:
  `docs/superpowers/specs/2026-08-31-organization-public-research-design.md`
- Product roadmap: `docs/product-roadmap.md`
- Current technical state: `brain/status.md`; decisions: `brain/log/decisions.md`

## Language

The secretary answers in the visitor's language. Public UI copy is local and deterministic;
stored organization content is never machine-translated at rest. The fictional seed corpus is
Portuguese. Code, comments, and technical documentation are English.
