# Handoff — 2026-08-30 — from Codex

## Task

Validate the complete bilingual Studio foundation and record its public-safe security
boundary after the live smoke check.

## Done

- The beta URLs are `/en/onboarding`, `/pt/onboarding`, `/en/studio`, and `/pt/studio`;
  unsupported beta locales return 404.
- Organization save, trusted refresh, and publish succeeded for the active Clerk
  organization. Exact Portuguese validation succeeded, and per-organization published
  counts were one.
- Personal smoke verification found exactly one empty Personal context root. Its profile
  edits remain in React/browser memory and reset on refresh; persistence is intentionally
  disabled pending managed key-management review.
- The deterministic preview made no AI request. The latest `usage_ledger` entry predates
  the smoke. Member-write rejection is automated/auth-layer evidence, not a second live
  account.
- The disposable smoke branch was deleted and Development was left untouched.
- `850d2fc` — constrained the chat Route Handler export surface before this documentation
  task.

## Next action

Provision and review the public-research integration and managed key management, including
retention, consent, threat-model, and recovery decisions. Keep private notes, reminders,
passwords/credentials, calendar connection, research, export, and deletion inactive until a
separate reviewed implementation plan is approved.

## Files in play

- `README.md` — exact beta URLs and public boundary.
- `brain/status.md` — present verified state and deferred gates.
- `brain/log/decisions/2026-Q3.md` — Task 6 decision record.
- `tests/app/studio-no-ai.test.ts` — no-AI/sensitive-source regression.

## Ruled out

- No private notes, reminders, passwords/credentials, calendar connection, research,
  export, or deletion were enabled.
- Personal profile persistence after refresh is not claimed.
- No live member account, secret, ID, customer data, or external side effect was added.

## Verify

Run `npm test -- --reporter=dot`, `npm run typecheck`, `npm run build`, targeted lint for
changed files, and `git diff --check`.
