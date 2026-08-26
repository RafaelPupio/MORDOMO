# AI Secretary SaaS Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an invite-only, multi-organization AI Secretary beta with Clerk authentication, saved profiles, five localized interfaces, and a safe public chat URL for each organization.

**Architecture:** Clerk Hobby is the identity and standard organization-membership authority; Neon remains the source of organization-scoped application data and stores each workspace owner’s Clerk user ID. A migration renames the church domain to organization without changing IDs, then server-only context helpers bind every staff mutation and public chat request to a verified organization. Typed local dictionaries provide `en`, `pt`, `es`, `fr`, and `de`; Studio saves a typed profile that drives copy and the secretary prompt.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Clerk `@clerk/nextjs`, Drizzle ORM + Neon Postgres, Vercel AI Gateway, Vitest, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-25-ai-secretary-saas-beta-design.md`

## Global Constraints

- Clerk is connected only to Vercel Development on its free Hobby plan; use default `org:admin` and `org:member` roles plus application-stored owner identity. Do not create Stripe resources, checkout, invoices, or paid-plan UI.
- Keep the seeded Igreja da Colina data as the first church preset while all product-facing and server-domain names become organization-neutral.
- Derive organization identity from Clerk server context or a validated public slug; never from a client-supplied organization ID.
- Preserve existing rate limits, budget gates, source citations, safe Markdown rendering, document checks, and human approval flows.
- Support exactly `en`, `pt`, `es`, `fr`, and `de`; use English as the safe fallback.
- Do not claim appointment booking, phone/SMS, or outbound delivery capabilities.
- Automated tests must mock model calls. Run at most one paid live smoke test only after all automated verification passes.

---

### Task 1: Establish the Clerk-ready baseline

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/app/layout.tsx`
- Create: `src/proxy.ts`, `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/sign-up/[[...sign-up]]/page.tsx`
- Test: `tests/app/auth-shell.test.tsx`

**Interfaces:**
- Consumes: `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` from Development `.env.local`.
- Produces: `ClerkProvider` root context and `proxy.ts` protection for `/onboarding`, `/studio`, `/staff`, and protected API paths.

- [ ] **Step 1: Install the supported Clerk SDK and establish the untouched test baseline.**

Run:
```bash
npm install @clerk/nextjs
npm test
npm run typecheck
```

Expected: the existing suite and typecheck pass before application behavior changes.

- [ ] **Step 2: Write the failing auth-shell tests.**

Add a test that mocks `@clerk/nextjs` and asserts the root layout renders `ClerkProvider`, plus route tests asserting `/sign-in` renders Clerk `SignIn` and `/sign-up` renders `SignUp`.

```ts
vi.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="clerk">{children}</div>,
  SignIn: () => <div>sign in</div>,
  SignUp: () => <div>sign up</div>,
}));
```

- [ ] **Step 3: Run the focused test to verify it fails.**

Run: `npm test -- tests/app/auth-shell.test.tsx`

Expected: FAIL because the provider and auth pages do not exist.

- [ ] **Step 4: Add the smallest Clerk shell.**

Wrap the existing layout body with `ClerkProvider`; do not add a global navigation header. Add the Clerk hosted components in the two catch-all routes. Create `src/proxy.ts` with `clerkMiddleware()` and `createRouteMatcher` so public pages remain public while protected paths call `auth.protect()`.

```ts
const isProtected = createRouteMatcher([
  '/onboarding(.*)', '/studio(.*)', '/staff(.*)', '/api/ingest(.*)', '/api/cron(.*)',
]);
export default clerkMiddleware(async (auth, request) => {
  if (isProtected(request)) await auth.protect();
});
```

- [ ] **Step 5: Run the focused tests and typecheck.**

Run:
```bash
npm test -- tests/app/auth-shell.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the isolated authentication shell.**

```bash
git add package.json package-lock.json src/app/layout.tsx src/proxy.ts src/app/sign-in src/app/sign-up tests/app/auth-shell.test.tsx
git commit -m "feat(auth): add clerk application shell"
```

### Task 2: Migrate the persistent tenant domain to organizations

**Files:**
- Modify: `src/db/schema.ts`, every `src/db/repo/*.ts`, `src/core/channel.ts`, `src/ai/usage.ts`, `src/core/rate-limit.ts`, `scripts/seed.ts`, all affected tests
- Create: `drizzle/0005_rename_churches_to_organizations.sql`, `src/db/repo/organizations.ts`, `src/db/repo/organization-profiles.ts`, `src/core/organization-profile.ts`
- Delete: `src/db/repo/churches.ts` after imports move
- Test: `tests/db/schema.test.ts`, `tests/db/repos.test.ts`, `tests/core/organization-profile.test.ts`

**Interfaces:**
- Produces `Organization`, `getOrganizationBySlug(db, slug)`, and `OrganizationProfile`.
- `OrganizationProfile` is `{ industry: Industry; defaultLocale: Locale; assistantName: string; replyTone: ReplyTone; greeting: string; escalationCopy: string; enabledCapabilities: Capability[] }`.

- [ ] **Step 1: Write failing profile and schema tests.**

Cover valid defaults, rejected unknown locale/capability values, and organization-scoped repository lookup. Keep a test that confirms every former `church_id` reference now uses `organization_id`.

```ts
expect(parseOrganizationProfile({ defaultLocale: 'fr', enabledCapabilities: ['knowledge', 'escalation'] }).defaultLocale).toBe('fr');
expect(() => parseOrganizationProfile({ defaultLocale: 'xx' })).toThrow();
```

- [ ] **Step 2: Run the focused tests to verify failure.**

Run: `npm test -- tests/core/organization-profile.test.ts tests/db/schema.test.ts tests/db/repos.test.ts`

Expected: FAIL because organization types and migration are absent.

- [ ] **Step 3: Implement the additive-safe migration and typed profile parser.**

Use `ALTER TABLE ... RENAME TO` and `ALTER TABLE ... RENAME COLUMN` for the named table and foreign-key columns, preserving IDs and constraints. Add `clerk_organization_id` and `owner_clerk_user_id` to `organizations`; create an `organization_profiles` table keyed by `organization_id` and seed defaults that reproduce Igreja da Colina’s current behavior. Generate the Drizzle schema from the migration; do not delete data or recreate tables.

```ts
export const organizationProfiles = z.object({
  industry: z.enum(['church', 'clinic', 'restaurant', 'real_estate', 'general']),
  defaultLocale: localeSchema,
  assistantName: z.string().trim().min(1).max(80),
  replyTone: z.enum(['warm', 'professional', 'concise']),
  greeting: z.string().trim().max(280),
  escalationCopy: z.string().trim().max(280),
  enabledCapabilities: z.array(capabilitySchema).min(2).max(4),
});
```

- [ ] **Step 4: Rename repository and server-domain identifiers coherently.**

Move `getChurchBySlug` to `getOrganizationBySlug`; replace `churchId` parameters, rate-limit keys, schema fields, and error/log labels with `organizationId`. Preserve test behavior and the `demo` seeded slug. Do not make a temporary alias available to production code—update all callers in this task.

- [ ] **Step 5: Run database and affected route tests.**

Run:
```bash
npm test -- tests/db tests/core/organization-profile.test.ts tests/channels/web.test.ts tests/channels/ingest-http.test.ts
npm run typecheck
```

Expected: PASS with no `churchId` production identifiers remaining outside migration history and fixture prose.

- [ ] **Step 6: Verify migration in an isolated database branch, then commit.**

Run the migration against a disposable Neon branch or local PGlite fixture. Confirm `organizations` contains the seeded row and every foreign key resolves. Commit:

```bash
git add drizzle src scripts tests
git commit -m "feat(tenancy): generalize church data to organizations"
```

### Task 3: Bind authenticated staff and public chat to trusted organizations

**Files:**
- Create: `src/core/organization-context.ts`, `src/core/public-organization.ts`
- Modify: `src/channels/web.ts`, `src/channels/ingest-http.ts`, `src/core/staff-context.ts`, `src/app/api/chat/route.ts`, `src/app/api/chat/history/route.ts`, all staff actions/pages, cron route
- Test: `tests/core/organization-context.test.ts`, `tests/channels/web.test.ts`, `tests/app/api/chat/route.test.ts`, `tests/app/staff-actions.test.ts`

**Interfaces:**
- `requireOrganizationContext(): Promise<{ organizationId: string; organization: Organization; role: OrganizationRole }>`
- `resolvePublicOrganization(slug: string): Promise<Organization | null>`
- `assertOrganizationRole(role, minimumRole): void`

- [ ] **Step 1: Write failing ownership tests.**

Mock Clerk `auth()` and `clerkClient().organizations.getOrganizationMembershipList()`. Test that a forged `organizationId` form field cannot affect another row, an unknown public slug returns 404 before calling the model, and a member cannot save profile settings.

```ts
await expect(requireOrganizationContext()).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
expect(await handleWebRequest(requestFor('/api/chat?organization=other'))).toHaveProperty('status', 404);
```

- [ ] **Step 2: Run focused tests to verify failure.**

Run: `npm test -- tests/core/organization-context.test.ts tests/channels/web.test.ts tests/app/api/chat/route.test.ts tests/app/staff-actions.test.ts`

Expected: FAIL because the shared password and demo slug still control access.

- [ ] **Step 3: Implement Clerk-backed organization context.**

Read `userId`, `orgId`, and `orgRole` only from Clerk server auth. Load the matching Neon row by `clerkOrganizationId`, then use only that row’s UUID for queries and writes. Treat `userId === ownerClerkUserId` as Owner, map Clerk’s default `org:admin` to Admin, and map `org:member` to Member. Replace HMAC session code and password routes. Keep public visitor identity separate and resolve the organization from a validated slug exactly once per request.

```ts
const { userId, orgId, orgRole } = await auth();
if (!userId || !orgId || !orgRole) redirect('/sign-in');
const organization = await getOrganizationByClerkId(getDb(), orgId);
if (!organization) redirect('/onboarding');
return { organizationId: organization.id, organization, role: mapOrganizationRole({ userId, orgRole, ownerClerkUserId: organization.ownerClerkUserId }) };
```

- [ ] **Step 4: Add localized public route adapters.**

Move the public chat UI to `/{locale}/o/{slug}/chat`; pass only the validated slug to the channel adapter. Retain a redirect from the old `/chat` route to the seeded demo’s English/Portuguese canonical URL for portfolio compatibility.

- [ ] **Step 5: Run ownership, API, and staff action tests.**

Run:
```bash
npm test -- tests/core/organization-context.test.ts tests/channels/web.test.ts tests/channels/ingest-http.test.ts tests/app/api/chat/route.test.ts tests/app/staff-actions.test.ts
npm run typecheck
```

Expected: PASS; all staff mutations and public requests use a trusted organization identity.

- [ ] **Step 6: Commit the tenancy boundary.**

```bash
git add src tests
git commit -m "feat(auth): scope operations to clerk organizations"
```

### Task 4: Make the secretary profile-driven without inventing capabilities

**Files:**
- Modify: `src/agent/secretary.ts`, `src/agent/reply-drafter.ts`, `src/agent/extractor.ts`, `src/agent/verifier.ts`, `src/agent/analyst.ts`, `src/agent/report-writer.ts`, `src/db/repo/prayer.ts`, relevant staff pages
- Create: `src/core/capabilities.ts`
- Test: `tests/agent/secretary.test.ts`, `tests/core/capabilities.test.ts`, `tests/agent/reply-drafter.test.ts`

**Interfaces:**
- `buildSecretaryPrompt(profile: OrganizationProfile, organizationName: string): string`
- `getEnabledSecretaryTools(deps, ctx, capabilities): Record<string, Tool>`
- `CAPABILITIES = ['knowledge', 'calendar', 'confidential_request', 'escalation'] as const`

- [ ] **Step 1: Write failing prompt/tool tests.**

Assert a clinic profile never receives church or prayer instructions, the church profile maps confidential requests to prayer workflow, disabled calendar removes that tool, and every prompt retains grounding and escalation rules.

```ts
expect(buildSecretaryPrompt(clinicProfile, 'Clínica Aurora')).not.toContain('prayer');
expect(Object.keys(getEnabledSecretaryTools(deps, ctx, ['knowledge', 'escalation']))).toEqual(['searchKnowledge', 'escalateToHuman']);
```

- [ ] **Step 2: Run focused tests to verify failure.**

Run: `npm test -- tests/agent/secretary.test.ts tests/core/capabilities.test.ts tests/agent/reply-drafter.test.ts`

Expected: FAIL because church terms and all four tools are hard-coded.

- [ ] **Step 3: Implement profile-aware prompt and controlled tool selection.**

Replace church-specific prompt prose and descriptions with organization-neutral terms. Keep the existing data tables and privacy rules; the church preset alone supplies the prayer-oriented label. Build tools from validated capability constants, never client text.

- [ ] **Step 4: Update reporting and staff vocabulary.**

Replace church-office prose in prompts and UI with profile-aware organization/staff wording while keeping privacy aggregation semantics unchanged.

- [ ] **Step 5: Run all agent tests without network models.**

Run: `npm test -- tests/agent tests/core/capabilities.test.ts`

Expected: PASS with mocked model dependencies only.

- [ ] **Step 6: Commit profile-driven behavior.**

```bash
git add src tests
git commit -m "feat(secretary): apply organization profiles safely"
```

### Task 5: Add typed locale infrastructure and localized public routes

**Files:**
- Create: `src/i18n/locales.ts`, `src/i18n/messages.ts`, `src/i18n/format.ts`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx`
- Modify: `src/app/page.tsx`, `src/app/chat/page.tsx`, `src/app/chat/chat.tsx`, `src/app/layout.tsx`
- Test: `tests/i18n/locales.test.ts`, `tests/i18n/messages.test.ts`, `tests/app/locale-routing.test.tsx`

**Interfaces:**
- `type Locale = 'en' | 'pt' | 'es' | 'fr' | 'de'`
- `parseLocale(input: string | undefined): Locale`
- `getMessages(locale: Locale): Messages`
- `localizedPath(locale: Locale, path: string): string`

- [ ] **Step 1: Write failing locale tests.**

Cover exact acceptance of five codes, English fallback, identical message-key shape across dictionaries, and prefix generation that omits `en` from default marketing URLs.

```ts
expect(parseLocale('de')).toBe('de');
expect(parseLocale('xx')).toBe('en');
expect(localizedPath('fr', '/o/demo/chat')).toBe('/fr/o/demo/chat');
```

- [ ] **Step 2: Run focused tests to verify failure.**

Run: `npm test -- tests/i18n tests/app/locale-routing.test.tsx`

Expected: FAIL because locale modules and dynamic route are absent.

- [ ] **Step 3: Implement typed dictionaries and route shell.**

Create one canonical English message object and use `satisfies typeof en` for the four translations. Validate `[locale]` server-side with `notFound()` for unsupported prefixes, set `html lang`, and format dates/numbers using `Intl` with locale maps.

- [ ] **Step 4: Move the portfolio home into the locale route.**

Refactor the current design into a reusable `PortfolioHome({ locale, messages })`. Translate every visible marketing string and preserve the visual design, language selector, repository/spec links, and citation example. Make `/` render the English version and `/pt`, `/es`, `/fr`, `/de` render their counterparts.

- [ ] **Step 5: Move visitor chat into locale/organization routes.**

Translate input labels, empty state, loading/error/budget messages, metadata, and source labels. Keep user/model messages unchanged because they already use the visitor’s language.

- [ ] **Step 6: Run locale tests, typecheck, and build.**

Run:
```bash
npm test -- tests/i18n tests/app/locale-routing.test.tsx
npm run typecheck
npm run build
```

Expected: PASS; each of the five public routes renders without an unsupported-locale fallback leak.

- [ ] **Step 7: Commit localization foundation.**

```bash
git add src tests
git commit -m "feat(i18n): localize portfolio and public chat"
```

### Task 6: Build invite-only onboarding and Secretary Studio

**Files:**
- Create: `src/app/onboarding/page.tsx`, `src/app/onboarding/actions.ts`, `src/app/studio/page.tsx`, `src/app/studio/actions.ts`, `src/app/studio/secretary-studio-form.tsx`
- Modify: `src/core/organization-context.ts`, `src/i18n/messages.ts`
- Test: `tests/app/onboarding-actions.test.ts`, `tests/app/studio-actions.test.ts`, `tests/app/studio/secretary-studio-form.test.tsx`, `tests/db/organization-profiles.test.ts`

**Interfaces:**
- `saveOrganizationProfile(input: { organizationId: string; profile: OrganizationProfile }): Promise<Organization>`
- `updateStudioProfile(formData: FormData): Promise<StudioActionState>`
- `StudioActionState = { ok?: string; error?: string; fieldErrors?: Partial<Record<ProfileField, string>> }`

- [ ] **Step 1: Write failing repository/action tests.**

Test profile creation for an invited Clerk organization, owner/admin save success, member rejection, validation errors, and an organization A action unable to update organization B.

```ts
await expect(updateStudioProfile(formDataFor({ assistantName: '' }))).resolves.toMatchObject({ fieldErrors: { assistantName: expect.any(String) } });
```

- [ ] **Step 2: Run focused tests to verify failure.**

Run: `npm test -- tests/db/organization-profiles.test.ts tests/app/onboarding-actions.test.ts tests/app/studio-actions.test.ts tests/app/studio/secretary-studio-form.test.tsx`

Expected: FAIL because onboarding and Studio do not exist.

- [ ] **Step 3: Implement invite-only onboarding.**

Require a Clerk organization membership; create the matching Neon organization once from trusted Clerk metadata, initialize the `beta` entitlement and profile defaults, then redirect to Studio. Do not expose anonymous workspace creation or any price/checkout control.

- [ ] **Step 4: Implement Studio with a no-cost preview.**

Render a server-loaded profile and a client form for name, industry, assistant, default locale, tone, greeting, escalation copy, and capability checkboxes. Validate with the shared profile schema. The preview renders deterministic local copy and canonical public URL; it must not call the AI Gateway.

- [ ] **Step 5: Run focused tests and browser-independent smoke rendering.**

Run:
```bash
npm test -- tests/db/organization-profiles.test.ts tests/app/onboarding-actions.test.ts tests/app/studio-actions.test.ts tests/app/studio/secretary-studio-form.test.tsx
npm run typecheck
```

Expected: PASS and no usage-ledger write from profile preview tests.

- [ ] **Step 6: Commit the beta workspace configuration.**

```bash
git add src tests
git commit -m "feat(studio): add saved secretary configuration"
```

### Task 7: Localize and complete the staff workspace

**Files:**
- Modify: `src/app/staff/**`, `src/app/[locale]/**`, `src/i18n/messages.ts`, `src/core/format.ts`
- Create: `src/app/[locale]/staff/(dashboard)/layout.tsx` and locale route wrappers as needed
- Test: `tests/app/staff-localization.test.tsx`, `tests/app/staff-actions.test.ts`

**Interfaces:**
- Staff route components receive locale through a validated server helper, not client query values.
- Existing staff actions consume `requireOrganizationContext()` and return translated action-state keys resolved at the caller.

- [ ] **Step 1: Write failing staff locale and role tests.**

Assert Portuguese, Spanish, French, and German navigation labels render; English fallback remains stable; a member cannot reach Owner-only settings; existing ticket/report/document actions remain organization-scoped.

- [ ] **Step 2: Run focused tests to verify failure.**

Run: `npm test -- tests/app/staff-localization.test.tsx tests/app/staff-actions.test.ts`

Expected: FAIL because staff is single-language and tied to the retired password session.

- [ ] **Step 3: Refactor staff layouts, pages, and action messages.**

Use dictionary keys for all visible strings, date/number formatting, empty states, and action feedback. Replace every `requireStaffContext` call with the Clerk-backed organization context. Keep the report renderer structural and dependency-free; do not introduce HTML rendering or a Markdown package.

- [ ] **Step 4: Run the entire staff and reporting test set.**

Run: `npm test -- tests/app/staff tests/app/staff-actions.test.ts tests/core/weekly-report.test.ts tests/agent/report-writer.test.ts`

Expected: PASS with no direct references to the retired session API.

- [ ] **Step 5: Commit localized staff operations.**

```bash
git add src tests
git commit -m "feat(staff): localize organization workspace"
```

### Task 8: Complete regression verification, migration validation, and one controlled demo

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-08-25-ai-secretary-saas-beta-design.md` only if implemented behavior differs
- Test: entire `tests/` suite plus new e2e organization flow

**Interfaces:**
- The public route contract is `/{locale}/o/{slug}/chat`.
- Beta entitlement is the only available plan and no Stripe invocation occurs.

- [ ] **Step 1: Add the end-to-end no-network organization flow test.**

Seed two organizations in PGlite, mock Clerk context and the language model, save one profile, request its public route, and prove the other organization’s source and ticket data never appear.

```ts
expect(await response.text()).toContain('Aurora');
expect(await response.text()).not.toContain('Igreja da Colina private source');
```

- [ ] **Step 2: Run the test to verify it fails before the final wiring.**

Run: `npm test -- tests/e2e/organization-isolation.test.ts`

Expected: FAIL until final routing/context wiring is complete.

- [ ] **Step 3: Complete the smallest missing wiring and rerun the focused test.**

Run: `npm test -- tests/e2e/organization-isolation.test.ts`

Expected: PASS using only mock AI dependencies.

- [ ] **Step 4: Run the full automated verification suite.**

Run:
```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Apply migration only to a disposable Neon branch, then inspect integrity.**

Verify migrated row counts, foreign keys, profile defaults, and the old seeded public URL redirect. Do not run the migration against Production or Preview.

- [ ] **Step 6: Run one controlled Development browser smoke test.**

Sign in with a beta invite, save a profile, open the public localized chat URL, send one representative question, verify citations and the correct organization name, then query the usage ledger once and stop. Record the measured cost in `README.md` only if it is useful and non-sensitive.

- [ ] **Step 7: Commit verification documentation.**

```bash
git add README.md docs tests
git commit -m "docs: verify ai secretary beta"
```
