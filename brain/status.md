# Status

> Present state on `feat/merge-saas-beta` while the no-ff merge is being completed.
> Public repository: only fictional data and publishable technical evidence belong here.

## Product

MORDOMO is an organization-focused, multilingual AI secretary. The original fictional
Igreja da Colina portfolio experience remains intact while the beta adds isolated
organization workspaces and a deliberately narrow Personal preview.

The public portfolio deployment remains `https://mordomo-demo.vercel.app`. The SaaS beta
uses separate Development services and is not represented as a public production service.
Billing and self-serve production onboarding are intentionally absent.

## What runs

- Streaming visitor chat uses one tool-calling secretary with grounded knowledge search,
  calendar lookup, prayer-request creation, and human escalation. Conversation ownership is
  tied to a server-minted cookie and staff replies appear when the visitor returns.
- Retrieval uses pgvector and cites stored excerpts. The committed ten-question Portuguese
  benchmark is runnable with `npm run benchmark:retrieval`.
- Document ingest parses, chunks, embeds, extracts candidate events, then sends them to a
  separate verifier before publication. Candidate counts and prompt inputs are bounded.
- The staff area manages documents, verified calendar events, prayer requests, tickets,
  editable AI reply drafts, reports, usage, and retention visibility.
- Weekly reporting separates bounded analysis from prose generation and minimizes sensitive
  prayer data with a closed theme vocabulary.
- Every AI path is metered by organization, guarded by tenant/global monthly budgets and the
  applicable visitor or workflow rate limits.

## SaaS beta

- Clerk provides Development-only sign-in and active-organization membership. Application
  tables use `organization_id`; owner/admin writes and tenant isolation are enforced server-side.
- The public presentation is typed in English, Portuguese, Spanish, French, and German.
- Bilingual onboarding and Studio live at `/en/*` and `/pt/*`. Organization profiles support
  typed draft save, trusted refresh, deterministic preview, versioned snapshots, and explicit
  publish. Controls lock across concurrent save/refresh/publish operations.
- Personal Secretary remains a deterministic browser-local preview. Only an empty context root
  persists; edits reset on refresh. Private notes, credentials, reminders, calendar linkage,
  export, and deletion require separate security designs.
- Organization public research is implemented for one explicitly consented public HTTPS page.
  It uses a fresh Browserbase session with recording/logging disabled, bounded visible text,
  quote-grounded AI proposals, usage metering, and mandatory admin review. Accepted facts are
  saved before the existing separate publish action. It never runs for Personal contexts.
- Firecrawl is retired. Browserbase passed API and dashboard retention checks; only opaque,
  content-free session metadata remains under the provider's bounded retention.

## Operations and safety

- Neon Postgres + pgvector stores tenant data. Vercel AI Gateway routes all models. Vercel Cron
  owns weekly reports and the nightly retention route.
- `RETENTION_DAYS` is inert when unset, invalid, or outside 30..3650. Valid configuration ages
  only eligible resolved records, performs unscoped protective-reference checks, re-checks before
  deletion, and exposes dry-run counts in `/staff/uso`.
- Upload and request limits are enforced at both framework and application boundaries. Scanned
  PDFs return an OCR-specific hint. Calendar tool output is JSON-safe and uses an explicit local
  wall-clock convention.
- Browserbase research forbids authenticated pages, cookies, custom headers, contexts, proxies,
  screenshots, provider AI, Stagehand, and open search/crawl.

## Merge state

- `feat/merge-saas-beta` merges main `92dcd5d` with feature `2820fe9` using `--no-ff`.
- The feature side contains 61 linear commits (the earlier estimate of 60 was stale); all are
  retained.
- Source, documentation, and Drizzle conflicts are resolved.
- Main added SQL `0005_past_the_professor.sql` and
  `0006_tickets_prayers_updated_at.sql`. The feature added
  `0005_rename_churches_to_organizations.sql`, `0006_bilingual_personal_studio.sql`, and
  `0007_public_research.sql`.
- The dev Neon migration table's last row is id 7, timestamp `2026-09-08T18:51:26.478Z`, matching
  main's `0006_tickets_prayers_updated_at` journal timestamp; its stored hash matches no current
  SQL file on either side. No external database migration has been run during this merge.
- All five historical SQL files remain byte-for-byte intact. Their journal entries are ordered
  by their original timestamps, followed by the new idempotent `0010_merge_saas_beta` bridge.
  The bridge catches main-derived databases up, no-ops after a complete feature history, and
  refuses partially migrated phases.
- Drizzle metadata validation is green. PGlite verifies clean, main-derived, and
  feature-derived histories; `npm test` passes 592 tests across 73 files and
  `npm run typecheck` exits 0.

## Merge completion

Merge commit `f39df9c` preserves both parents and is ready to push through origin's GitHub and
GitLab URLs. The remaining step is opening the PR against `main` with the migration evidence
and approved decision in its body.
