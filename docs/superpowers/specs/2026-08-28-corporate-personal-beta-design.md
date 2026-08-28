# MORDOMO Corporate + Personal Beta — Design

**Date:** 2026-08-28  
**Status:** Approved product boundary; architecture ready for review  
**Scope:** Invite-only English/Portuguese beta for organization and individual secretary contexts.

## Goal

MORDOMO lets a beta client configure and test an AI secretary for either an
organization or themselves. The setup assistant helps turn a selected segment, approved
public research, and client-provided preferences into a reviewable secretary profile.

The beta demonstrates useful tailoring without claiming capabilities it cannot securely
deliver. In particular, it does not accept raw passwords, does not connect to a personal
calendar yet, and does not claim to solve WhatsApp-number takeover.

This addendum replaces the public-sandbox scope from 2026-08-27 and controls any
conflicting beta scope in the 2026-08-25 design. It narrows the trial interface from five
languages to English and Portuguese. The five-language public portfolio remains unchanged.

## Contexts and identity

Every signed-in client explicitly selects one context before configuring or testing:

| Context | Intended use | Visibility | Membership |
|---|---|---|---|
| Organization workspace | A company, office, clinic, church, or local service | May expose a separate public secretary URL | Clerk organization owner/admin/member roles |
| Personal Secretary | One individual's private assistant | Never public | The signed-in owner only |

The server derives the context from the authenticated Clerk session and its matching Neon
record. A browser-supplied workspace, user, or profile ID is never authority. Switching
contexts clears the prior context from the UI and starts a new trusted server resolution.
Personal records never share a foreign key, query, prompt context, export, or analytics
aggregate with an organization workspace.

## Beta journey

1. An invited client signs in and chooses **Organization** or **Personal Secretary**.
2. They select a segment (including Personal Secretary), describe their goal, choose
   English or Portuguese, and optionally provide a public company website and city.
3. MORDOMO's setup assistant asks a short, progressive questionnaire: audience, common
   requests, escalation owner, opening/availability rules, voice, and prohibited actions.
4. For organization contexts only, the client can ask for public-segment research. The
   client reviews the public sources and proposed facts before they influence a profile.
5. The client edits the profile, chooses warm / professional / concise voice, and runs
   deterministic test conversations. A reviewed live AI suggestion is optional and always
   visibly distinct from the deterministic test result.
6. The client publishes an organization secretary only after review. A Personal Secretary
   remains private and has no public URL.
7. The client can inspect, export, or delete their context data from the control center.

## Setup assistant and public research

The setup assistant is a guided profile builder, not an autonomous agent with authority.

- It converts questionnaire answers into typed fields: assistant identity, audience,
  supported requests, escalation rules, tone, language, availability, and boundaries.
- Free-form instructions are stored as untrusted client content. Prompt construction places
  them in a clearly delimited configuration section; non-negotiable safety, tenancy, and
  grounding rules remain system controlled.
- Organization research uses only the selected segment, city, and a client-approved public
  website. It never sends private notes, personal data, chat history, or credentials to a
  research provider.
- Research returns a source list and proposed facts. Nothing is silently imported; the
  client explicitly accepts, edits, or rejects each item. Sources and accepted facts are
  auditable.
- The required public-research integration is **Firecrawl** (Vercel Marketplace,
  `web-automation` category), selected because it is the catalog result for web data used by
  AI agents. It must be provisioned and its data-retention terms reviewed before this step
  is enabled. Until then, setup remains questionnaire-only.
- The existing AI Gateway is the sole model path. Automated tests use mocks and never
  spend model credit. Before live personalized prompting, configure and verify the gateway's
  zero-data-retention/no-training controls and keep an explicit user-consent record.

## Customization and test console

`/studio` becomes a bilingual owner-facing control center with a context switcher.

### Shared controls

- Assistant name, language (English or Portuguese), tone, greeting, escalation language,
  availability, approved capabilities, and do-not-do rules.
- Plain-language explanation of what the configured assistant can and cannot do.
- A versioned draft and an explicit publish action; every published version can be restored.
- Deterministic scenarios that reveal whether a selected capability is available, produces a
  cited answer, or safely escalates. They do not call an LLM.

### Optional live test

A client can supply a test message and request a live answer after seeing a warning that it
will use their current draft. The response displays the profile version, source citations,
and a quick rating: **sounds like me**, **more professional**, **warmer**, or **revise**.
Feedback updates only the draft; it never silently retrains a model or changes production.
Rate limits and a per-context budget protect the beta from accidental spend.

### Personal Secretary controls

The Personal Secretary may store private notes, reminders, and manually entered calendar
metadata after the encrypted-data prerequisite below is complete. It cannot book, message,
retrieve passwords, diagnose health information, or make decisions for the client. It
labels reminders and calendar data as private and requires the owner to confirm before
using them in a live test.

## Sensitive data boundary

The first beta does **not** accept, store, display, export, or send to an AI model:

- raw passwords, recovery codes, API keys, card or bank data;
- government IDs, biometric data, or highly sensitive health detail;
- WhatsApp verification codes, device-linking material, or account-recovery secrets.

Personal profile preferences, private notes, reminders, and calendar metadata are sensitive
by default. They may be persisted only after a managed key-management service is chosen,
provisioned, and reviewed. A database connection protected with TLS and encrypted storage is
not, by itself, the required application-level control.

The encryption design must use per-record authenticated encryption, envelope keys managed
outside the application database, key versioning and rotation, minimal decrypted lifetimes,
and no plaintext in logs, metrics, prompts, exports, or error traces. Marketplace discovery
did not provide a key-management service; selecting one is a blocking security-design task,
not an implementation shortcut.

Before this prerequisite is complete, Personal Secretary may be demoed with deterministic,
browser-local sample state only. It must show a clear **not saved** label and never imply
that personal information is protected in production.

## Data controls and accountability

- The owner can view a data inventory grouped by profile, research, tests, notes, reminders,
  and calendar metadata.
- Export produces a portable, structured archive for the selected context only. It requires
  recent reauthentication and is recorded in an audit trail without copying private content
  into the trail.
- Delete requires recent reauthentication and a confirmation phrase. It deletes the selected
  context and schedules encrypted-content erasure; the UI transparently states any backup
  retention window rather than promising impossible instantaneous deletion.
- Sensitive operations (export, delete, context switch, research acceptance, publish) are
  audit events containing actor, context, action, time, and result—not note/message text.
- MFA, session revocation, rate limits, budgets, role checks, and server-side context
  resolution are required controls. The beta may not describe itself as “extremely secure”
  until the corresponding controls are implemented and independently reviewed.

## Data model and routes

Existing `organizations` and `organization_profiles` remain for corporate workspaces. Add a
separate `personal_contexts` root keyed by the trusted Clerk user ID, not by an organization
ID. All child records carry exactly one parent scope:

- `secretary_profile_versions` — organization or personal context, typed configuration,
  draft/published state, and non-sensitive audit metadata;
- `research_briefs` and `research_sources` — organization-only public inputs, source URL,
  review state, and accepted fact text;
- `private_items` — personal-only encrypted payload, item type (`note`, `reminder`,
  `calendar_metadata`), encryption version, and deletion state; blocked until managed keys
  are ready;
- `data_control_events` — actor, context type/id, action, and outcome without content.

Routes are bilingual under `/en` and `/pt` for beta account surfaces. The existing default
English route may remain canonical only if it redirects consistently. Public portfolio routes
remain `/`, `/pt`, `/es`, `/fr`, and `/de`; no other beta locale is promised.

## Delivery gates

1. **Foundation:** Clerk Organizations, trusted organization context, and migration tests.
2. **Bilingual Studio:** context selection, profile versions, deterministic scenarios, and
   English/Portuguese dictionaries. No sensitive persistence yet.
3. **Research:** provision Firecrawl; complete retention/consent review; implement
   source-review workflow with organization-only public inputs.
4. **Personal data:** approve threat model, provision managed key management, implement
   encrypted private items, reauthentication, audit controls, export, and deletion.
5. **Live beta:** enable optional AI-assisted setup and live tests only after budget,
   rate-limit, consent, and gateway data-handling checks pass.

## Verification

- Unit tests prove context parsing rejects forged IDs and that a personal context cannot
  resolve as an organization context (or vice versa).
- Repository/API tests prove every read, mutation, export, and delete scopes to one trusted
  context; cross-context and cross-member attacks fail.
- Tests keep sensitive strings out of logs, audit events, research requests, and model input.
- Encryption integration tests verify ciphertext-only persistence, key-version handling, and
  deletion behavior on a disposable database branch. A security review is required before
  real private-item storage is enabled.
- Browser tests cover EN/PT onboarding, context switching, research consent/review,
  customization, deterministic tests, live-test consent state, export reauthentication, and
  delete confirmation.
- Automated tests mock AI and research calls. Any manual live smoke test uses fictional,
  non-sensitive content and one bounded request.

## Explicit non-goals

- Password manager or storage of login credentials.
- Direct Google/Apple/Outlook calendar authorization, appointment booking, or medical advice.
- WhatsApp account-recovery implementation, account-takeover guarantee, or storage of
  verification material.
- Payment, public self-signup, multilingual beta UI beyond English and Portuguese, and
  automatic publishing of unreviewed AI or web research.
