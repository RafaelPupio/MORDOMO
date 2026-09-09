# Handoff — 2026-08-31T17:26:31Z — from claude-code

## Task
Ship MORDOMO (MORDOMO): an AI church secretary built as a public portfolio
piece demonstrating ten AI capabilities. All four product plans are built and merged;
the only work left is the first real deployment.

## Done
- Renamed the project to **MORDOMO** everywhere — folder, package, docs, brain, UI, and
  the design spec filename. Bare "ChurchChatBox" left intact: that is V1. (`231c83b`)
- Plans 1–4 all merged to `main`: visitor chat with cited RAG, document ingest
  (extractor → verifier), staff area, weekly reporting + portfolio front door.
  318 tests, typecheck and lint clean.
- Stopped the Neon skills installer from re-ignoring `.env.example`: it appends a bare
  `.env*` after the `!.env.example` negation. Only harmless because the file was
  already tracked — a fresh clone would have dropped it. (`12b2627`)
- Repo was renamed on GitHub to `RafaelPupio/MORDOMO`; the landing page's four
  hardcoded links now point there instead of relying on GitHub's rename redirect.
  (`91c4efd`)

## Gotchas discovered late
- The GitHub integration auto-deploys every push; `vercel ls` shows ~20 builds. They are
  NOT a demo — `ssoProtection` redirects every deployment URL to a Vercel login, and
  there is no database. Do not claim deployment state without running `vercel ls`.
- The Vercel project is `mordomo`, but its domain stays `churchchatboxv2.vercel.app`;
  `mordomo.vercel.app` belongs to an unrelated app. A custom domain is the only fix.
- `ssoProtection: all_except_custom_domains` protects the per-deployment URLs but NOT the
  project's production domain. Smoke-test `churchchatboxv2.vercel.app`, never a
  `mordomo-<hash>-rafael-e2fe.vercel.app` — the latter only ever proves the protected side.

## Next action
**Nothing is blocking.** Data retention shipped on 2026-09-09, inert by default: nothing
is deleted until `RETENTION_DAYS` is set in Vercel. That choice is Rafael's; 365 is the
sensible default. The `/staff/uso` card shows the policy state and what the first night
would remove; the nightly job logs "dry run" with counts until then.

377 tests / 43 files, CI green, production READY. Migrations 0005 (`reports.generated_at`)
and 0006 (`tickets/prayer_requests.updated_at`) are applied to production; legacy resolved
rows carry the migration timestamp on purpose (see the decisions log).

The "Next" list in [[status]] is a choice plus two deliberate gaps, not work in progress.

## Files in play
- `brain/status.md` — the live picture of what runs; read this before anything else.
- `scripts/retrieval-benchmark.ts` — the 10/10 score in the docs is offline-only
  (`HashEmbedder`). Re-running it against the real embedder is a launch gate.
- `src/app/page.tsx` — public front door; every capability claim must map to real code.

## Ruled out
- Provisioning Neon unattended — `vercel integration add neon` returns
  `integration_terms_acceptance_required` and will not proceed without a browser.
  Do not retry it from the CLI expecting a different result.
- Accepting those marketplace terms on Rafael's behalf — a legal agreement, his to make.
- `db.transaction(...)` for ingest atomicity — the `neon-http` driver throws
  "No transactions support"; ingest uses careful delete/insert ordering instead.
- Committing `.agents/` and `skills-lock.json` — local agent-tooling artifacts, now
  gitignored so the public repo stays product-only.

## Verify
```bash
cd ~/Desktop/Tech/MORDOMO && npm test && npm run typecheck && npm run build
```
Expected: 318 tests pass across 36 files, `tsc --noEmit` silent, build succeeds with
`/`, `/chat`, `/staff/*` and `/api/cron/weekly-report` in the route table.
