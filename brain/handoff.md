# Handoff — 2026-08-31T11:40:07Z — from codex

## Task

Close the final bilingual Studio UX gaps without changing persistence, authorization, or
the deterministic preview safety boundary.

## Done

- English and Portuguese now own every deterministic scenario prompt, result, and fictional
  citation while sharing one typed result-kind/capability mapping per segment.
- The Studio rail translates visible result-kind, capability, tone, context, and test labels;
  onboarding and Studio locale links identify the active page to assistive technology.
- Organization profile fields and Save lock during Save, trusted refresh, and Publish. A new
  edit or save clears stale Publish feedback. Personal remains browser-memory-only and keeps
  its existing persistence controls disabled.
- Focused regressions cover exact Portuguese copy, shared safety mappings, preserved
  user-authored text, locale-link state, and pending-Publish locking.

## Next action

Provision and review the public-research integration and managed key management, including
retention, consent, threat-model, and recovery decisions. Keep private notes, reminders,
passwords/credentials, calendar connection, research, export, and deletion inactive until a
separate reviewed implementation plan is approved.

## Files in play

- `src/studio/scenarios.ts` — locale-owned deterministic copy and shared safety mapping.
- `src/components/studio/secretary-studio.tsx` — translated rail and publish-cycle locking.
- `src/components/studio/context-picker.tsx` — locale-owned onboarding tags and active links.
- `tests/studio/` and `tests/app/beta-locale-routing.test.ts` — focused regression coverage.
- `brain/status.md` and `brain/log/decisions/` — public technical state and decision record.

## Ruled out

- No persistence, action, schema, auth, Personal storage, AI, research, or external-service
  behavior changed.
- User-authored greeting and escalation text are never translated.
- `.agents/` and `skills-lock.json` remain unrelated and untracked.

## Verify

Run `npm test -- --reporter=dot`, `npm run typecheck`, targeted ESLint for changed source and
test files, `npm run build -- --webpack`, and `git diff --check`. On this host, the default
Turbopack build is expected to fail because its child process cannot bind a port; that is a
sandbox limitation rather than an application build failure.
