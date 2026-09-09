# MORDOMO — project rules

MORDOMO is the organization-focused AI secretary that succeeds ChurchChatBox V1. V1 stays
separate and church-focused; this public repository is where the broader beta evolves.

## Brain first

Read `brain/INDEX.md` first, then only the note the task needs. Never bulk-read the vault.
A task is finished only when `brain/status.md` and `brain/log/decisions.md` reflect it.

## This repo is PUBLIC

Show the technical work without exposing private material:

- Never commit secrets, API keys, or `.env*` files.
- Never commit pricing analysis, competitor strategy, revenue plans, or V1 paid-SaaS
  internals. Those belong in the private ChurchChatBox repo.
- Use fictional data only. No real organization or personal data, ever.
- Keep the brain technical and publishable.

## Specs are contracts

- Foundation: `docs/superpowers/specs/2026-08-18-mordomo-design.md`
- Active beta: `docs/superpowers/specs/2026-08-25-ai-secretary-saas-beta-design.md`

The brain is the fast path; approved specs are authoritative.

## Stack conventions

- Next.js App Router on Vercel, TypeScript, Drizzle ORM, Vitest.
- Neon Postgres + pgvector. Every tenant table is keyed by `organization_id`.
- AI SDK v6 through Vercel AI Gateway with plain `"anthropic/claude-*"` model strings.
  Sonnet where quality shows; Haiku for routing, extraction, and background work.
- Scheduled work runs on Vercel Cron. No local schedulers.
- Every LLM call is metered in `usage_ledger` by tenant. No exceptions.

## Cost discipline

Use per-visitor rate limits, per-tenant monthly budgets, and a global monthly cap with
graceful degradation. Target running cost: $10–50/month.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
