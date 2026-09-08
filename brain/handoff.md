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
**Nothing is blocking.** Every user-reachable surface a 207-item inventory could name has
now been exercised in production or ruled unreachable; the last real defects (a `Date` in
`getCalendar`'s output killing every "próximos eventos" answer; Next's 1 MB Server Action
body cap under a form that promised 5 MB; a public page still saying "not deployed") were
fixed on 2026-09-07/08. 357 tests / 41 files, CI green, production READY.

Read the "Next" list in [[status]] — it is deliberate gaps, not work in progress. If one
thing is picked up next, it is data retention.

Standing rules that cost the most to learn are in [[status]] under "Standing rules": test
the first production run of anything; compute shared facts in code; reload after a deploy
before testing a Server Action; a tool result must survive JSON.

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
