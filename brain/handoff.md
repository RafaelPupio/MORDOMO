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

## Next action
Deployment is blocked on one human step: Rafael must accept the Neon Marketplace
terms in a browser (the screen does not render for a CLI/unattended session). Ask him
to run `vercel integration add neon --plan free_v3 -m region=gru1 -m auth=false` and
complete the terms prompt. Once that lands, in order:
`npm run db:migrate` → `npm run seed` (REAL embedder, never `SEED_FAKE_EMBEDDER`) →
set `AI_GATEWAY_API_KEY`, `STAFF_PASSWORD`, `STAFF_SESSION_SECRET`, `CRON_SECRET` →
`BENCHMARK_REAL_EMBEDDER=1 npm run benchmark:retrieval` → `vercel deploy --prod`.

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
