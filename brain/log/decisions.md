# Decisions log

Append-only. Newest at the bottom of each day, newest day at the top.

<!-- rotated: this file is an index -->

Index only — one line per decision. Full entries live in `decisions/<year>-Q<n>.md`
next to this file. Open the quarter you need, never the whole history.

## 2026-Q3 — `decisions/2026-Q3.md`

- `2026-08-18` founding decisions
- `2026-08-19` planning decisions
- `2026-08-20` decisions forced by building Plan 1
- `2026-08-20` Plan 2, Task 6: `POST /api/ingest` gated by a placeholder shared secret
- `2026-08-20` Plan 2
- `2026-08-20` Plan 2 whole-branch review: fail-closed is not fail-destructive, and
- `2026-08-20` Plan 3: staff operations, and retiring `INGEST_TOKEN`
- `2026-08-20` Plan 3 whole-branch review: a staff reply now actually reaches the visit…
- `2026-08-20` Plan 4, Task 5: cron route, and a note on `vercel.json`'s schedule
- `2026-08-24` Plan 4: reporting pipeline and portfolio front door
- `2026-08-31` Repo hygiene after the rename: tooling artifacts out, `.env.example` protected, links follow the rename
- `2026-08-31` The project is MORDOMO: renamed everywhere except V1 references and the Vercel project
- `2026-08-31` Correction: the Vercel project is renamed, deployments already existed, and the URL stays churchchatboxv2.vercel.app
- `2026-08-31` Correction: Neon terms were already accepted; the blocker was stale, and cloud state must be checked live
- `2026-09-04` The Neon database attached to the mordomo project belongs to another app — do not migrate into it
- `2026-09-04` MORDOMO deployed on its own Neon database; 10/10 retrieval with real embeddings; only Vercel Auth remains
- `2026-09-05` Correction: the demo was already public — `all_except_custom_domains` exempts the production domain, and every smoke test had probed a protected deployment URL
- `2026-09-05` Acceptance pass: the two-agent ingest pipeline had never worked — the verifier was never told the extractor's UTC convention and rejected 100% of correct events
- `2026-09-05` Typecheck, lint and tests all passed on a commit `next build` rejected; two prod deploys sat in ERROR behind a healthy alias — CI now builds
- `2026-09-05` Review pass: static reviewers refuted the midnight-crossing bug 0/3, a live probe hit it 2/2; the verifier now gets local time rendered in code and never sees UTC (0/27)
