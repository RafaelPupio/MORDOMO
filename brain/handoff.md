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
**Nothing is blocking.** The demo is public, and as of the 2026-09-05 acceptance pass every
advertised capability has run in production at least once. 350 tests / 41 files, typecheck,
lint and build clean, CI green on GitHub. Public URL: <https://mordomo-demo.vercel.app>.

That pass found and fixed two real defects — read the acceptance section in [[status]]
before assuming anything about the ingest pipeline. Short version: the verifier was rejecting
100% of correct events; two prompt fixes made it differently wrong; the fix that held moves
the UTC→local conversion into code so the verifier never sees UTC (0/27 in a live probe).
The upload message had hidden all of it.

Open, in rough order of value:
1. **Monday 2026-09-07, 09:00 UTC** — first unattended cron report. The 31/08–06/09 row
   already exists (generated on demand to exercise the analyst → writer pair); the cron
   replaces it by `(churchId, periodStart)`. If it does not appear, look there.
2. **Ingest has no queue** — `POST /api/ingest` runs inline under `maxDuration = 300`.
3. `brain/log/decisions/2026-Q3.md` is 52 KB, over the 20 KB split rule. It is read on
   demand only (`decisions.md` is the index), so it costs nothing per session — but a
   Q4 file should start rather than growing this one further.

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
