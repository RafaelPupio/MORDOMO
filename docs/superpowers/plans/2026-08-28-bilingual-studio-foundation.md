# MORDOMO Bilingual Studio Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first invite-only MORDOMO Studio increment: trusted Organization/Personal contexts, versioned Organization profiles, browser-local Personal Secretary tests, EN/PT configuration, and deterministic secretary tests.

**Architecture:** Keep the existing organization domain and add a separate `personal_contexts` root keyed by trusted Clerk user ID. Persist typed draft/published history for Organizations only; Personal Secretary configuration stays in browser memory until managed key management is provisioned. Deterministic scenarios never call an AI model. Organization and personal identity are resolved exclusively on the server from Clerk before any repository access.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Clerk v7, Drizzle ORM, Neon Postgres, PGlite, Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-corporate-personal-beta-design.md`

## Global Constraints

- This plan changes only `/Users/rafaelpupiovieira/Desktop/Tech/ChurchChatBoxV2-saas-beta`; ChurchChatBox V1 stays untouched.
- Beta account surfaces are English and Portuguese only; public portfolio routes remain `/`, `/pt`, `/es`, `/fr`, and `/de`.
- Use Clerk server `auth()` state as the only authority for user and organization identity. Never accept a context, organization, or user ID from a form, URL, or browser state as authority.
- Before enabling the Organization path, configure Clerk Development Organizations as membership-required and disable self-service organization creation; invite the beta client to an organization from Clerk. The app may switch an invited active organization but may not create one.
- Persist only typed non-sensitive configuration. Do not add note, reminder, calendar, password, credential, personal-information, research, AI-call, export, or deletion tables in this increment.
- No Firecrawl provisioning or web research implementation. No managed key-management service is selected or installed.
- No AI Gateway call is allowed in automated tests or Studio preview/scenario code; do not write the usage ledger from this increment.
- Manage schema only through Drizzle migration files. Verify migrations in PGlite first and a disposable Neon branch before Development Neon.
- Keep all visible Studio and onboarding strings in typed EN/PT dictionaries; do not introduce runtime translation.
- Use default Node.js/Fluid Compute. Do not add an Edge runtime export.

## File map

| File | Responsibility |
|---|---|
| `src/core/secretary-profile.ts` | Typed, non-sensitive profile schema and defaults shared by Organization and Personal contexts. |
| `src/core/secretary-context.ts` | Clerk-derived server context resolution and role checks. |
| `src/db/schema.ts` + `drizzle/0006_bilingual_personal_studio.sql` | Empty Personal root and versioned Organization-profile persistence. |
| `src/db/repo/personal-contexts.ts` | Get-or-create personal root by trusted Clerk user ID. |
| `src/db/repo/secretary-profile-versions.ts` | Draft/publish profile version queries scoped to one Organization. |
| `src/i18n/beta-messages.ts` | EN/PT-only beta labels, validation copy, and scenario strings. |
| `src/studio/scenarios.ts` + `src/studio/preview.ts` | Deterministic, capability-aware test matrix and preview helper. |
| `src/app/[locale]/onboarding/**` | Protected EN/PT entry route that selects a trusted Personal or active Organization context. |
| `src/app/[locale]/studio/**` | Protected Studio pages/actions; form submits only typed profile values. |
| `src/components/studio/**` | Client-only controls and semantic, deterministic preview. |
| `tests/**` | Unit, repository, action, routing, and anti-AI-call coverage. |

---

### Task 1: Establish the bilingual, non-sensitive Studio domain

**Files:**
- Create: `src/core/secretary-profile.ts`
- Create: `src/i18n/beta-messages.ts`
- Create: `tests/core/secretary-profile.test.ts`
- Create: `tests/i18n/beta-messages.test.ts`

**Interfaces:**
- Produces `type BetaLocale = 'en' | 'pt'`, `parseBetaLocale(value: string): BetaLocale | null`, and `getBetaMessages(locale: BetaLocale): BetaMessages`.
- Produces `type SecretaryContextKind = 'organization' | 'personal'`, `type SecretarySegment = Industry | 'personal'`, and `type SecretaryProfile`.
- Produces `parseSecretaryProfile(input: unknown): SecretaryProfile` and `DEFAULT_SECRETARY_PROFILES: Record<SecretaryContextKind, SecretaryProfile>`.

- [ ] **Step 1: Write failing domain and locale tests.**

```ts
import { describe, expect, it } from 'vitest';
import { parseSecretaryProfile } from '@/core/secretary-profile';
import { getBetaMessages, parseBetaLocale } from '@/i18n/beta-messages';

it('accepts only English and Portuguese beta locales', () => {
  expect(parseBetaLocale('en')).toBe('en');
  expect(parseBetaLocale('pt')).toBe('pt');
  expect(parseBetaLocale('fr')).toBeNull();
});

it('rejects credentials and private free text from the persisted profile shape', () => {
  expect(() => parseSecretaryProfile({
    assistantName: 'Mia', defaultLocale: 'pt', replyTone: 'warm',
    greeting: 'Olá!', escalationCopy: 'Vou encaminhar.',
    enabledCapabilities: ['knowledge', 'escalation'], segment: 'personal',
    password: 'not-allowed', privateNotes: 'not-allowed',
  })).toThrow();
});

it('keeps English and Portuguese dictionaries structurally identical', () => {
  expect(Object.keys(getBetaMessages('pt')).sort()).toEqual(Object.keys(getBetaMessages('en')).sort());
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail.**

Run: `npm test -- tests/core/secretary-profile.test.ts tests/i18n/beta-messages.test.ts`

Expected: FAIL because the Studio schema and beta dictionaries do not exist.

- [ ] **Step 3: Implement strict schemas and dictionaries.**

Create the profile parser with `.strict()` so unrecognized fields—including password-like or free-form private fields—cannot silently enter the persisted JSON. Reuse existing `ReplyTone` and `Capability` values from `src/core/organization-profile.ts`, but define a separate `BetaLocale` union and only allow the segments below.

```ts
export const betaLocaleSchema = z.enum(['en', 'pt']);
export const secretaryContextKindSchema = z.enum(['organization', 'personal']);
export const secretarySegmentSchema = z.enum([
  'church', 'clinic', 'restaurant', 'real_estate', 'general', 'personal',
]);

export const secretaryProfileSchema = z.object({
  segment: secretarySegmentSchema,
  defaultLocale: betaLocaleSchema,
  assistantName: z.string().trim().min(1).max(80),
  replyTone: replyToneSchema,
  greeting: z.string().trim().min(1).max(280),
  escalationCopy: z.string().trim().min(1).max(280),
  enabledCapabilities: z.array(capabilitySchema).min(2).max(4),
}).strict();
```

Implement `getBetaMessages(locale)` as `BETA_MESSAGES[locale]`; use `satisfies BetaMessages` for Portuguese so missing keys fail typecheck. Keep `src/i18n/locales.ts` unchanged because it controls the five-language public portfolio.

- [ ] **Step 4: Add valid-default and invalid-shape coverage.**

```ts
it('uses a Personal Secretary Portuguese default without private fields', () => {
  const profile = parseSecretaryProfile(DEFAULT_SECRETARY_PROFILES.personal);
  expect(profile).toMatchObject({ segment: 'personal', defaultLocale: 'pt' });
  expect(profile).not.toHaveProperty('notes');
});
```

- [ ] **Step 5: Run the focused suite and typecheck.**

Run:
```bash
npm test -- tests/core/secretary-profile.test.ts tests/i18n/beta-messages.test.ts
npm run typecheck
```

Expected: PASS; French/German/Spanish are rejected by beta-locale parsing while public-locale tests remain unchanged.

- [ ] **Step 6: Commit the domain foundation.**

```bash
git add src/core/secretary-profile.ts src/i18n/beta-messages.ts tests/core/secretary-profile.test.ts tests/i18n/beta-messages.test.ts
git commit -m "feat(studio): add bilingual profile domain"
```

### Task 2: Add isolated Personal roots and versioned Organization profiles

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0006_bilingual_personal_studio.sql`
- Create: `src/db/repo/personal-contexts.ts`
- Create: `src/db/repo/secretary-profile-versions.ts`
- Create: `tests/db/personal-contexts.test.ts`
- Create: `tests/db/secretary-profile-versions.test.ts`
- Modify: `tests/helpers/db.ts`

**Interfaces:**
- Produces `getOrCreatePersonalContext(db: Db, clerkUserId: string): Promise<PersonalContext>`.
- Produces `getLatestOrganizationSecretaryProfile(db, organizationId: string): Promise<SecretaryProfileVersion | undefined>`.
- Produces `saveOrganizationSecretaryProfileDraft(db, organizationId: string, profile: SecretaryProfile): Promise<SecretaryProfileVersion>`.
- Produces `publishOrganizationSecretaryProfile(db, organizationId: string, versionId: string): Promise<SecretaryProfileVersion>`.

- [ ] **Step 1: Write failing PGlite repository tests.**

```ts
it('creates an empty Personal root without storing a profile', async () => {
  const db = await createTestDb();
  const personal = await getOrCreatePersonalContext(db, 'user_personal');
  expect(personal.clerkUserId).toBe('user_personal');
  expect(Object.keys(personal).sort()).toEqual(['clerkUserId', 'createdAt', 'id']);
});

it('creates exactly one Personal root for a Clerk user', async () => {
  const db = await createTestDb();
  const first = await getOrCreatePersonalContext(db, 'user_42');
  const second = await getOrCreatePersonalContext(db, 'user_42');
  expect(second.id).toBe(first.id);
});
```

- [ ] **Step 2: Run the repository tests and confirm failure.**

Run: `npm test -- tests/db/personal-contexts.test.ts tests/db/secretary-profile-versions.test.ts`

Expected: FAIL because the tables and repositories are absent.

- [ ] **Step 3: Write the additive Drizzle schema and migration.**

Add `personalContexts` with a unique `clerk_user_id` and no content columns. Add `secretaryProfileVersions` with a non-null `organization_id`, UUID `id`, `status`, `profile` JSONB, and timestamps, plus an index ordered by organization and `created_at`. The SQL migration must have a partial unique index allowing no more than one published Organization profile. Do not add a Personal-context foreign key until the managed key-management gate is complete.

```sql
CREATE UNIQUE INDEX "secretary_profile_versions_one_published_organization"
  ON "secretary_profile_versions" ("organization_id")
  WHERE "status" = 'published';
```

Do not add `private_items`, encrypted columns, research fields, exports, or cascade-delete behavior in this migration.

- [ ] **Step 4: Implement scope-safe repositories.**

Use `where(and(eq(secretaryProfileVersions.organizationId, organizationId), ...))` for every version query; never construct a dynamic column from client input. Parse the stored JSONB through `parseSecretaryProfile` before returning it. Insert each draft as an immutable UUID-backed history row; publish it only after the repository verifies that the requested `versionId` belongs to that organization.

```ts
export async function publishOrganizationSecretaryProfile(db: Db, organizationId: string, versionId: string) {
  return db.transaction(async (tx) => {
    const version = await getSecretaryProfileByIdForOrganization(tx, organizationId, versionId);
    if (!version) throw new Error('Profile version not found for this context.');
    await clearPublishedOrganizationSecretaryProfile(tx, organizationId);
    return markOrganizationSecretaryProfilePublished(tx, organizationId, version.id);
  });
}
```

- [ ] **Step 5: Add cross-scope and publication tests.**

```ts
it('replaces only the selected organization published version', async () => {
  const first = await publishOrganizationSecretaryProfile(db, organizationA.id, organizationADraft.id);
  await publishOrganizationSecretaryProfile(db, organizationB.id, organizationBDraft.id);
  expect((await getLatestOrganizationSecretaryProfile(db, organizationA.id))?.id).toBe(first.id);
});
```

- [ ] **Step 6: Run migration-backed tests and typecheck.**

Run:
```bash
npm test -- tests/db/personal-contexts.test.ts tests/db/secretary-profile-versions.test.ts tests/db/schema.test.ts
npm run typecheck
```

Expected: PASS; PGlite applies migration `0006`, profile JSON is parsed on read, and Personal roots contain no profile payload.

- [ ] **Step 7: Verify migration safely and commit.**

Run PGlite tests first. Create a disposable Neon branch, use its direct migration URL only for `npm run db:migrate`, verify schema/counts there, and never migrate Development Neon in this task. Then commit:

```bash
git add drizzle src/db tests/db tests/helpers/db.ts
git commit -m "feat(data): add personal studio contexts"
```

### Task 3: Resolve trusted Organization and Personal contexts from Clerk

**Files:**
- Create: `src/core/secretary-context.ts`
- Modify: `src/db/repo/organizations.ts`
- Modify: `src/proxy.ts`
- Create: `tests/core/secretary-context.test.ts`
- Modify: `tests/app/auth-shell.test.ts`

**Interfaces:**
- Produces `requireSecretaryContext(kind: SecretaryContextKind): Promise<SecretaryContext>`.
- Produces `requireStudioWriteContext(kind: SecretaryContextKind): Promise<SecretaryContext>`.
- Produces `ensureActiveClerkOrganization(db: Db): Promise<Organization>` for the protected organization onboarding route only.
- Produces `type SecretaryContext = OrganizationSecretaryContext | PersonalSecretaryContext`.
- `OrganizationSecretaryContext` has `{ kind: 'organization'; userId; organizationId; role: 'owner' | 'admin' }`; `PersonalSecretaryContext` has `{ kind: 'personal'; userId; personalContextId }`.

- [ ] **Step 1: Verify the Clerk Organization precondition.**

In the Clerk Development dashboard, enable Organizations, require membership, disable self-service organization creation, create one fictional test organization, and invite the beta test user. Do not copy any key, user ID, or organization ID into the repository. If the Clerk instance cannot enforce this invite-only behavior, stop this task before writing UI that exposes organization switching.

- [ ] **Step 2: Write failing Clerk-mocked context tests.**

```ts
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

it('does not use a requested organization ID when Clerk active organization differs', async () => {
  mockedAuth.mockResolvedValue({ userId: 'user_owner', orgId: 'org_clerk_a', orgRole: 'org:admin' });
  await expect(requireSecretaryContext('organization')).resolves.toMatchObject({ organizationId: seededA.id });
});

it('rejects an organization member from Studio writes', async () => {
  mockedAuth.mockResolvedValue({ userId: 'user_member', orgId: 'org_clerk_a', orgRole: 'org:member' });
  await expect(requireStudioWriteContext('organization')).rejects.toThrow('Studio access denied');
});
```

- [ ] **Step 3: Run the focused tests and confirm failure.**

Run: `npm test -- tests/core/secretary-context.test.ts tests/app/auth-shell.test.ts`

Expected: FAIL because no Clerk-backed Studio context helper exists.

- [ ] **Step 4: Implement context derivation and organization lookup.**

Add `getOrganizationByClerkId(db, clerkOrganizationId)` and `upsertOrganizationFromClerk(db, clerkOrganization)` to the repository. `ensureActiveClerkOrganization` reads only `userId`, `orgId`, and `orgRole` from `await auth()`, requires `orgRole === 'org:admin'`, fetches the active organization through `await clerkClient()` and `client.organizations.getOrganization({ organizationId: orgId })`, and upserts its server-returned `id`, `name`, `slug`, and `createdBy`. It never takes these fields from the browser. An absent Clerk slug becomes the deterministic internal slug `org-${organization.id}`; a present Clerk slug is used as-is.

`requireSecretaryContext('organization')` loads the already mapped row by Clerk ID and accepts only the stored owner or Clerk `org:admin`. `requireSecretaryContext('personal')` reads only `userId` and calls `getOrCreatePersonalContext`; it ignores `orgId` completely.

```ts
const { userId, orgId, orgRole } = await auth();
if (!userId) throw new Error('Authentication required');
if (kind === 'personal') {
  return { kind, userId, personalContextId: (await getOrCreatePersonalContext(getDb(), userId)).id };
}
if (!orgId || !orgRole) throw new Error('Select an organization first.');
const organization = await getOrganizationByClerkId(getDb(), orgId);
if (!organization) throw new Error('Open organization onboarding first.');
const role = userId === organization.ownerClerkUserId ? 'owner' : orgRole === 'org:admin' ? 'admin' : null;
if (!role) throw new Error('Studio access denied');
return { kind, userId, organizationId: organization.id, role };
```

- [ ] **Step 5: Protect canonical and bilingual account routes.**

Keep `/studio(.*)` and `/onboarding(.*)` protected. Add `/(en|pt)/studio(.*)` and `/(en|pt)/onboarding(.*)` to `isProtectedRoute`. Do not protect the public portfolio or alter its locale matcher.

- [ ] **Step 6: Add forged-input and personal/org separation coverage.**

```ts
it('creates a Personal context from the authenticated user only', async () => {
  mockedAuth.mockResolvedValue({ userId: 'user_trusted', orgId: 'org_other', orgRole: 'org:member' });
  await expect(requireSecretaryContext('personal')).resolves.toMatchObject({ userId: 'user_trusted' });
});
```

- [ ] **Step 7: Run context tests, typecheck, and commit.**

Run:
```bash
npm test -- tests/core/secretary-context.test.ts tests/app/auth-shell.test.ts
npm run typecheck
```

Expected: PASS; role/context tests never receive tenant identity from browser input.

```bash
git add src/core/secretary-context.ts src/db/repo/organizations.ts src/proxy.ts tests/core/secretary-context.test.ts tests/app/auth-shell.test.ts
git commit -m "feat(auth): resolve trusted studio contexts"
```

### Task 4: Build deterministic scenario and preview logic

**Files:**
- Create: `src/studio/scenarios.ts`
- Create: `src/studio/preview.ts`
- Create: `tests/studio/scenarios.test.ts`
- Create: `tests/studio/preview.test.ts`

**Interfaces:**
- Produces `STUDIO_SCENARIOS: Record<SecretarySegment, StudioScenario>`.
- Produces `buildStudioPreview(profile: SecretaryProfile, scenario: StudioScenario): StudioPreview`.
- `StudioPreview` contains `{ greeting; assistantName; tone; result: StudioScenarioResult }`.

- [ ] **Step 1: Write failing deterministic test-matrix tests.**

```ts
it('covers all six segments with typed, no-cost scenarios', () => {
  expect(Object.keys(STUDIO_SCENARIOS).sort()).toEqual([
    'church', 'clinic', 'general', 'personal', 'real_estate', 'restaurant',
  ]);
});

it('escalates instead of promising a disabled capability', () => {
  const result = buildStudioPreview(withoutCalendar, STUDIO_SCENARIOS.restaurant);
  expect(result.result.kind).toBe('escalation');
  expect(result.result.citation).toBeUndefined();
});
```

- [ ] **Step 2: Run focused tests and confirm failure.**

Run: `npm test -- tests/studio/scenarios.test.ts tests/studio/preview.test.ts`

Expected: FAIL because no deterministic Studio helpers exist.

- [ ] **Step 3: Implement scenario data and safe preview rules.**

Create exactly six scenarios: church, clinic, restaurant, real estate, general organization, and Personal Secretary. Use an escalation result for clinic diagnosis/booking, real-estate availability, and every Personal Secretary request that would imply access to a private note or connected calendar. Grounded/calendar outcomes use clearly fictional citations. `buildStudioPreview` must copy only editable typed profile fields and return a fixed escalation when `requiredCapability` is absent.

```ts
export type StudioScenarioResult = {
  kind: 'grounded' | 'calendar' | 'intake' | 'escalation';
  text: string;
  requiredCapability: Capability;
  citation?: { title: string; excerpt: string };
};

export function buildStudioPreview(profile: SecretaryProfile, scenario: StudioScenario): StudioPreview {
  const result = profile.enabledCapabilities.includes(scenario.result.requiredCapability)
    ? scenario.result
    : { kind: 'escalation', text: profile.escalationCopy, requiredCapability: 'escalation' };
  return { greeting: profile.greeting, assistantName: profile.assistantName, tone: profile.replyTone, result };
}
```

- [ ] **Step 4: Prove preview code cannot consume AI credit.**

```ts
it('does not import AI SDK or usage modules', async () => {
  const previewSource = await readFile('src/studio/preview.ts', 'utf8');
  expect(previewSource).not.toMatch(/from ['\"](?:ai|@\/ai\/usage|@\/agent\/)/);
});
```

- [ ] **Step 5: Run deterministic tests and commit.**

Run:
```bash
npm test -- tests/studio/scenarios.test.ts tests/studio/preview.test.ts
npm run typecheck
```

Expected: PASS; no scenario can claim password storage, connected calendars, booking, messaging, or real research.

```bash
git add src/studio tests/studio
git commit -m "feat(studio): add deterministic secretary tests"
```

### Task 5: Build EN/PT onboarding and Studio pages

**Files:**
- Create: `src/app/[locale]/onboarding/page.tsx`
- Create: `src/app/[locale]/onboarding/actions.ts`
- Create: `src/app/[locale]/studio/page.tsx`
- Create: `src/app/[locale]/studio/actions.ts`
- Create: `src/app/onboarding/page.tsx`
- Create: `src/app/studio/page.tsx`
- Create: `src/components/studio/context-picker.tsx`
- Create: `src/components/studio/secretary-studio.tsx`
- Create: `tests/app/studio-actions.test.ts`
- Create: `tests/app/beta-locale-routing.test.ts`

**Interfaces:**
- Produces `saveStudioDraft(kind: SecretaryContextKind, formData: FormData): Promise<StudioActionState>`.
- Produces `publishStudioProfile(kind: SecretaryContextKind, versionId: string): Promise<StudioActionState>`.
- `type StudioActionState = { ok?: 'draftSaved' | 'published'; error?: 'forbidden' | 'invalid' | 'notFound' | 'personalNotSaved'; fieldErrors?: Partial<Record<keyof SecretaryProfile, string>> }`.

- [ ] **Step 1: Write failing action and route tests.**

```ts
it('keeps Personal Secretary configuration browser-local until keys are provisioned', async () => {
  const state = await saveStudioDraft('personal', formWith({ assistantName: 'Mia' }));
  expect(state).toEqual({ error: 'personalNotSaved' });
  expect(saveOrganizationSecretaryProfileDraft).not.toHaveBeenCalled();
});

it('rejects a forged Personal segment on an Organization save', async () => {
  const state = await saveStudioDraft('organization', formWith({ segment: 'personal' }));
  expect(state).toMatchObject({ error: 'invalid', fieldErrors: { segment: expect.any(String) } });
});

it('renders Studio only at English and Portuguese locale paths', async () => {
  await expect(renderRoute('/fr/studio')).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_NOT_FOUND') });
});
```

- [ ] **Step 2: Run focused tests and confirm failure.**

Run: `npm test -- tests/app/studio-actions.test.ts tests/app/beta-locale-routing.test.ts`

Expected: FAIL because onboarding and Studio routes/actions are absent.

- [ ] **Step 3: Implement locale-safe route shells and canonical redirects.**

Add `requireBetaRouteLocale(value)` inside the route module; it calls `parseBetaLocale` and `notFound()` for all non-EN/PT paths. Make `/studio` redirect to `/en/studio` and `/onboarding` redirect to `/en/onboarding`. Do not change `/[locale]/page.tsx`, which remains the public portfolio route.

```ts
function requireBetaRouteLocale(value: string): BetaLocale {
  const locale = parseBetaLocale(value);
  if (!locale) notFound();
  return locale;
}
```

- [ ] **Step 4: Implement context picker and onboarding boundary.**

Render Organization and Personal Secretary buttons with `aria-pressed`; selection is local UI state only. Render Clerk's `OrganizationSwitcher hidePersonal={true}` in the organization selection area so the client can select an already invited organization without app-owned identity state. This component is permitted only after Task 3's Clerk dashboard precondition disables self-service creation. The server action receives only the selected kind. For `organization`, it calls `ensureActiveClerkOrganization(getDb())`; for `personal`, it calls `requireSecretaryContext('personal')`; then it redirects to `/${locale}/studio?context=${kind}`. Show a translated “select an organization in Clerk first” error if Clerk has no active organization. Do not create organizations in the app and do not expose anonymous sign-up.

- [ ] **Step 5: Implement Studio form, deterministic preview, draft, and publish.**

Load the query `context` only as a selector. For `organization`, call `requireStudioWriteContext('organization')` server-side and load the latest version for its trusted organization ID. For `personal`, call `requireSecretaryContext('personal')` solely to establish that the user is signed in, then load a default profile into browser state without reading or writing any Personal profile record. The client component updates a local parsed `SecretaryProfile` and renders `buildStudioPreview` for both contexts. Organization submits use Server Actions; Personal buttons explain that the test is local and disable save/publish.

Parse the route/query context through `secretaryContextKindSchema` before selecting either branch. Both Server Actions repeat that parse: `saveStudioDraft('personal', ...)` and `publishStudioProfile('personal', ...)` return `{ error: 'personalNotSaved' }` before accessing a repository; only an Organization action may fetch a trusted write context or a profile version.

```ts
export async function saveStudioDraft(kind: SecretaryContextKind, formData: FormData): Promise<StudioActionState> {
  if (!secretaryContextKindSchema.safeParse(kind).success) return { error: 'notFound' };
  if (kind === 'personal') return { error: 'personalNotSaved' };
  const context = await requireStudioWriteContext(kind);
  const parsed = secretaryProfileSchema.safeParse({
    ...Object.fromEntries(formData),
    enabledCapabilities: formData.getAll('enabledCapabilities'),
  });
  if (!parsed.success) return { error: 'invalid', fieldErrors: toFieldErrors(parsed.error) };
  if (parsed.data.segment === 'personal') {
    return { error: 'invalid', fieldErrors: { segment: 'Personal is preview-only in this beta.' } };
  }
  await saveOrganizationSecretaryProfileDraft(getDb(), context.organizationId, parsed.data);
  return { ok: 'draftSaved' };
}
```

Do not render inputs for free-form private notes, website research, calendar connection, passwords, exports, or deletion in this release. The screen must visibly say that private notes and reminders are not saved in the beta foundation.

- [ ] **Step 6: Add accessibility and state tests.**

```ts
it('returns translated Organization validation state without exposing submitted content', async () => {
  const state = await saveStudioDraft('organization', formWith({ assistantName: '' }));
  expect(state).toMatchObject({ error: 'invalid', fieldErrors: { assistantName: expect.any(String) } });
  expect(JSON.stringify(state)).not.toContain('organizationId');
});
```

- [ ] **Step 7: Run action/routing tests, typecheck, and build.**

Run:
```bash
npm test -- tests/app/studio-actions.test.ts tests/app/beta-locale-routing.test.ts tests/studio
npm run typecheck
npm run build
```

Expected: PASS; `/en/studio` and `/pt/studio` are protected, `/fr/studio` is 404, and Studio tests never create usage-ledger rows.

- [ ] **Step 8: Commit the first client-facing beta experience.**

```bash
git add src/app src/components/studio tests/app
git commit -m "feat(studio): add bilingual secretary configuration"
```

### Task 6: Validate the complete foundation and record its security boundary

**Files:**
- Modify: `README.md`
- Modify: `brain/status.md`
- Modify: `brain/handoff.md`
- Modify: `brain/log/decisions/2026-Q3.md`
- Create: `tests/app/studio-no-ai.test.ts`

**Interfaces:**
- Produces documented beta URLs `/en/onboarding`, `/pt/onboarding`, `/en/studio`, and `/pt/studio`.
- Produces an explicit client-visible status that no private notes, reminders, passwords, calendar connection, research, export, or deletion is active in this foundation.

- [ ] **Step 1: Write the final no-AI and no-sensitive-route regression test.**

```ts
it('keeps Studio actions out of the model and sensitive-data paths', async () => {
  const actionSource = await readFile('src/app/[locale]/studio/actions.ts', 'utf8');
  expect(actionSource).not.toMatch(/generateText|streamText|usageLedger|privateItems|password|firecrawl/i);
});
```

- [ ] **Step 2: Run it and confirm failure if any forbidden import was introduced.**

Run: `npm test -- tests/app/studio-no-ai.test.ts`

Expected: PASS after the Studio implementation; a forbidden model or sensitive-store import makes the test fail.

- [ ] **Step 3: Run full automated verification.**

Run:
```bash
npm test -- --reporter=dot
npm run typecheck
npm run build
git diff --check
```

Expected: all tests, typecheck, build, and whitespace checks pass with zero live AI requests.

- [ ] **Step 4: Perform manual browser smoke checks with fictional content.**

Open the local development server and verify, while signed in with a development Clerk user:

1. `/en/onboarding` and `/pt/onboarding` show English/Portuguese labels and reject a non-EN/PT locale.
2. Personal selection creates/reuses only that test user's empty Personal context, and all profile edits remain in browser memory after refresh.
3. Organization selection requires the active Clerk organization and rejects a member write.
4. Changing tone/name/capabilities immediately changes the deterministic preview without a network model request.
5. Saving creates a draft; publish switches only the current trusted context to published.
6. No screen asks for private notes, passwords, credentials, calendar authorization, research, export, or deletion.

- [ ] **Step 5: Update publishable project records and commit.**

Document the exact available scope and remaining gates, without customer data or secrets. Append the implementation decision and current next action to the V2 brain, then commit:

```bash
git add README.md brain tests/app/studio-no-ai.test.ts
git commit -m "docs: verify studio foundation boundary"
```

## Deferred second plan: Research and encrypted private data

Do not begin this work from the current plan. It has two external prerequisites that must be real and reviewed first:

1. Provision Firecrawl through the Vercel Marketplace, inspect its generated environment-variable names and retention terms, and record the client-approved public-research consent flow.
2. Select and provision managed key management outside the application database, approve its threat model and recovery process, then design encrypted private-item storage, reauthentication, export, deletion, and backup-retention behavior against that actual service.

Once both are complete, write a separate implementation plan from
`docs/superpowers/specs/2026-08-28-corporate-personal-beta-design.md`; do not invent SDKs,
environment-variable names, encryption keys, or deletion guarantees beforehand.
