# MORDOMO — project rules

AI-powered successor to ChurchChatBox (V1): a portfolio-grade showcase of an AI church
secretary, architected so it can become V1's next generation later.

## Brain first

Read `brain/INDEX.md` first, then open only the note the task needs. Never bulk-read the
vault. A task is finished only when `brain/status.md` and `brain/log/decisions.md` reflect
what changed.

## This repo is PUBLIC — curate what enters it

This is a portfolio repo. "Show our work without showing too much":

- **Never** commit secrets, API keys, or `.env*` files.
- **Never** commit business-sensitive material: pricing analysis, competitor strategy,
  revenue plans, or anything about V1's paid SaaS internals. That work belongs in the
  private ChurchChatBox repo.
- **Only fictional data.** The demo church, its documents, members, and prayer requests
  are invented. No real church's data, no real personal data, ever.
- The brain here is a *technical* brain (status, decisions, architecture). Keep it
  publishable.

## The spec is the contract

`docs/superpowers/specs/2026-08-18-mordomo-design.md` is the approved design.
The brain is the fast path; the spec is the authority.

## Stack conventions

- Next.js App Router on Vercel, TypeScript, Drizzle ORM, Vitest.
- Neon Postgres + pgvector. Every table keyed by `church_id` from day one.
- AI SDK v6 through Vercel AI Gateway with plain `"anthropic/claude-*"` model strings.
  Sonnet where quality shows (member chat), Haiku for routing/extraction/background work.
- All scheduled work runs on Vercel Cron (cloud). No local schedulers — this is why the
  repo may live under `~/Desktop`.
- Every LLM call is metered into `usage_ledger` (tokens + cost, per tenant). No exceptions.

## Cost discipline

Per-visitor rate limits, per-tenant monthly token budgets, and a global monthly cap that
degrades the demo gracefully. Target running cost: $10–50/mo.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
