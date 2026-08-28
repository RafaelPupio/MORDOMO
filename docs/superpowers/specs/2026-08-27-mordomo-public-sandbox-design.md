# MORDOMO Public Sandbox — Design

**Date:** 2026-08-27
**Status:** Superseded by `2026-08-28-corporate-personal-beta-design.md`; retained as the
original public-demo proposal.
**Scope:** Public, deterministic demonstration of how an organization tailors its MORDOMO secretary.

## Goal

Let a prospective client configure a believable version of MORDOMO and test how it responds across common organization segments—without a login, database write, source-document mutation, or AI Gateway request.

The sandbox demonstrates configuration, grounded-answer posture, citations, capability boundaries, and human hand-off. It does not masquerade as the future authenticated Secretary Studio.

## Product boundary

The sandbox is available publicly at `/sandbox`.

A visitor can:

1. Choose one preset: church, clinic, restaurant, real-estate office, or general local organization.
2. Change the assistant name, tone, default language, greeting, escalation wording, and enabled capabilities within the existing organization-profile validation rules.
3. See a chat preview update immediately from the same typed state.
4. Run a fixed test question for the selected preset and see one of four deterministic outcomes:
   - a grounded answer with a visible fictional source citation;
   - a calendar-information answer with a citation;
   - a confidential/contact-intake acknowledgement;
   - a transparent human escalation.
5. Reset the sandbox to the selected preset.

The public sandbox never saves changes. It never sends an email, creates a request, makes an appointment, processes a payment, calls a model, or exposes real organization data.

## Architecture

### Shared scenario model

Create `src/sandbox/scenarios.ts` as the single source of truth.

```ts
export type SandboxOutcomeKind = 'grounded' | 'calendar' | 'confidential_request' | 'escalation';

export type SandboxScenario = {
  id: Industry;
  label: string;
  organizationName: string;
  profile: OrganizationProfile;
  question: string;
  outcome: {
    kind: SandboxOutcomeKind;
    requiredCapability: Capability;
    response: string;
    citation?: { title: string; excerpt: string };
  };
};
```

The five scenarios use only `Industry`, `Capability`, `Locale`, and `OrganizationProfile` values already validated in `src/core/organization-profile.ts`. Scenario construction calls `parseOrganizationProfile`, so an invalid preset fails during test rather than producing a misleading demo.

### Deterministic preview helper

Create `src/sandbox/preview.ts`.

```ts
export type SandboxPreview = {
  greeting: string;
  assistantLabel: string;
  enabledCapabilities: Capability[];
  result: SandboxScenario['outcome'];
};

export function buildSandboxPreview(
  profile: OrganizationProfile,
  scenario: SandboxScenario,
): SandboxPreview;
```

The helper applies the visitor-facing identity from the editable profile while retaining the scenario's fixed, safe outcome. It does not call the agent or load a database. Each scenario names the capability that permits its outcome. If that capability is disabled, the helper returns the deterministic escalation outcome instead of showing a promise the configured assistant cannot fulfill.

### Client-only sandbox screen

Create `src/app/sandbox/page.tsx` as a server route that renders a small client component, `src/components/sandbox/secretary-sandbox.tsx`.

The component holds `selectedScenarioId` and `OrganizationProfile` in React state. Selecting a segment replaces the editable state with a validated clone of that preset. Field controls update a local candidate profile only after parsing through the existing schema. The right-hand chat panel reads `buildSandboxPreview` so every control has an immediately visible effect.

The page uses the same MORDOMO evergreen visual language as the public presentation. It explicitly labels the screen “Sandbox — changes are not saved” and describes the capabilities as demonstrations, not active production integrations.

## Segment test matrix

| Segment | Tone | Capabilities | Fixed question | Expected outcome |
|---|---|---|---|---|
| Church | warm | knowledge, calendar, confidential request, escalation | “What time is Sunday service?” | grounded with fictional source |
| Clinic | professional | knowledge, calendar, confidential request, escalation | “Do you offer pediatric consultations?” | escalation; no diagnosis or booking |
| Restaurant | concise | knowledge, calendar, escalation | “Are you open Sunday evening?” | grounded with fictional hours source |
| Real estate | professional | knowledge, calendar, confidential request, escalation | “Is the Riverside listing still available?” | escalation; no availability claim |
| General | warm | knowledge, calendar, confidential request, escalation | “How can I speak to your team?” | confidential/contact acknowledgement |

The test matrix deliberately chooses negative/hand-off results where a real answer would require live inventory, diagnosis, or booking. The sandbox makes the system's limits visible.

## Localization and accessibility

The sandbox uses English for this first public test route. It keeps all visitor text in a typed local dictionary alongside the component before it is later included in the five-route localization rollout.

Controls use `label` elements, keyboard-operable segment buttons with `aria-pressed`, descriptive status text for the current preview, and a semantic chat transcript. The reset action has a clear label and returns to the selected scenario's default profile.

## Testing

Unit tests:

- every scenario parses as an `OrganizationProfile`;
- exactly five scenarios cover every supported `Industry`;
- every scenario has at least two capabilities and a non-empty fixed question;
- `buildSandboxPreview` preserves editable name/greeting/tone;
- disabling a capability required by the scenario changes the outcome to escalation;
- grounded/calendar outcomes always include a fictional citation; escalation/confidential outcomes never invent one.

Browser smoke tests:

- `/sandbox` renders all five segment buttons;
- changing a segment visibly updates organization label and visitor preview;
- changing assistant name and greeting appears in the chat preview;
- disabling a capability makes the result safely escalate;
- reset returns the scenario defaults;
- mobile width has no horizontal overflow.

## Non-goals

- No real client accounts, organization writes, file upload, AI chat, live source retrieval, booking, messaging, payment, or analytics.
- No modification of the V1 product.
- No Clerk Organization setup or migration execution. Those remain the next authenticated-beta task.
