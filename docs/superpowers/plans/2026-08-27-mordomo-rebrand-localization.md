# MORDOMO Rebrand and Localized Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present the beta as MORDOMO, an AI secretary for organizations, with a polished portfolio home page in English, Portuguese, Spanish, French, and German.

**Architecture:** Keep the root route (`/`) as the English canonical page and add static locale routes at `/pt`, `/es`, `/fr`, and `/de`. A typed in-repository dictionary drives one shared marketing component, so every locale keeps the same proof-oriented product story and no translation service or client-side locale state is needed. A small brand module makes the product name and GitHub URL a single source of truth.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Tailwind CSS, Vitest, Clerk (existing provider only).

**Spec:** `docs/superpowers/specs/2026-08-25-ai-secretary-saas-beta-design.md`

## Global Constraints

- Product-facing identity is **MORDOMO**; V1 remains an independent church-focused product.
- Support exactly `en`, `pt`, `es`, `fr`, and `de`; unknown locale route values return a 404 rather than silently serving mixed-language content.
- English remains available at `/`; localized presentation routes are `/pt`, `/es`, `/fr`, and `/de`.
- Marketing copy describes an AI secretary for organizations, not a church-only product; Igreja da Colina remains clearly marked as a fictional example wherever it appears.
- Do not translate stored source documents, run a translation API, add a localization dependency, touch V1, alter database data, or rename the existing Vercel project `churchchatboxv2`.
- Preserve accessibility: semantic navigation, visible keyboard focus, descriptive labels, locale-specific document metadata, and reduced-motion-safe static presentation.
- Automated tests must not call the AI Gateway or require database credentials.

---

## File structure

- `src/brand.ts` — canonical product name and repository URL.
- `src/i18n/locales.ts` — locale union, route validation, display names, and route builder.
- `src/i18n/home-messages.ts` — fully typed marketing dictionaries and capability data.
- `src/components/marketing/mordomo-home.tsx` — shared, server-rendered portfolio presentation.
- `src/app/page.tsx` — English root route using the shared component.
- `src/app/[locale]/page.tsx` — locale-prefixed public presentation route with metadata.
- `src/app/layout.tsx` — MORDOMO site-wide metadata.
- `tests/i18n/locales.test.ts` — locale parsing and route-builder regression coverage.
- `tests/i18n/home-messages.test.ts` — dictionary completeness and brand-copy regression coverage.
- `README.md`, `CLAUDE.md`, `brain/INDEX.md`, `brain/status.md`, `brain/handoff.md`, and `brain/log/decisions/2026-Q3.md` — active public technical documentation and delivery state.

### Task 1: Create the brand and locale boundary

**Files:**
- Create: `src/brand.ts`
- Create: `src/i18n/locales.ts`
- Create: `src/i18n/home-messages.ts`
- Test: `tests/i18n/locales.test.ts`
- Test: `tests/i18n/home-messages.test.ts`

**Interfaces:**
- Produces `PRODUCT_NAME: 'MORDOMO'` and `GITHUB_REPOSITORY_URL: 'https://github.com/RafaelPupio/MORDOMO'`.
- Produces `type Locale = 'en' | 'pt' | 'es' | 'fr' | 'de'`, `SUPPORTED_LOCALES`, `parseLocale(value: string): Locale | null`, `localizedPath(locale: Locale): '/' | '/pt' | '/es' | '/fr' | '/de'`.
- Produces `HOME_MESSAGES: Record<Locale, HomeMessages>` and `getHomeMessages(locale: Locale): HomeMessages`.

- [x] **Step 1: Write the failing locale test**

```ts
import { describe, expect, it } from 'vitest';
import { localizedPath, parseLocale, SUPPORTED_LOCALES } from '@/i18n/locales';

describe('marketing locale routing', () => {
  it('accepts only the five supported locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'pt', 'es', 'fr', 'de']);
    expect(parseLocale('pt')).toBe('pt');
    expect(parseLocale('it')).toBeNull();
  });

  it('keeps English canonical at the root path', () => {
    expect(localizedPath('en')).toBe('/');
    expect(localizedPath('fr')).toBe('/fr');
  });
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run tests/i18n/locales.test.ts`

Expected: FAIL because `@/i18n/locales` does not exist.

- [x] **Step 3: Implement the smallest typed brand and locale modules**

```ts
export type Locale = 'en' | 'pt' | 'es' | 'fr' | 'de';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'pt', 'es', 'fr', 'de'];

export function parseLocale(value: string): Locale | null {
  return SUPPORTED_LOCALES.includes(value as Locale) ? (value as Locale) : null;
}

export function localizedPath(locale: Locale): '/' | `/${Exclude<Locale, 'en'>}` {
  return locale === 'en' ? '/' : `/${locale}`;
}
```

Define `PRODUCT_NAME` and the future GitHub URL in `src/brand.ts`. Define a `HomeMessages` interface that contains every visible heading, description, CTA, language label, capability, proof, status, and footer string. Supply one complete natural-language dictionary per supported locale; do not mix English fallback strings into a non-English dictionary.

- [x] **Step 4: Write the failing dictionary-completeness test**

```ts
import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from '@/brand';
import { getHomeMessages, HOME_MESSAGES } from '@/i18n/home-messages';
import { SUPPORTED_LOCALES } from '@/i18n/locales';

describe('MORDOMO home messages', () => {
  it('has a complete MORDOMO dictionary for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = getHomeMessages(locale);
      expect(HOME_MESSAGES[locale]).toBe(messages);
      expect(messages.hero.title).toContain(PRODUCT_NAME);
      expect(messages.capabilities).toHaveLength(10);
      expect(messages.languageLabel).not.toHaveLength(0);
    }
  });
});
```

- [x] **Step 5: Run the focused tests to verify they pass**

Run: `npx vitest run tests/i18n/locales.test.ts tests/i18n/home-messages.test.ts`

Expected: PASS with both locale boundaries and all five dictionaries covered.

- [x] **Step 6: Commit the independently testable boundary**

```bash
git add src/brand.ts src/i18n tests/i18n
git commit -m "feat: add Mordomo locale foundation"
```

### Task 2: Build the shared localized MORDOMO presentation

**Files:**
- Create: `src/components/marketing/mordomo-home.tsx`
- Create: `src/app/[locale]/page.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`
- Test: `tests/i18n/home-messages.test.ts`

**Interfaces:**
- Consumes `Locale`, `localizedPath`, `getHomeMessages`, `PRODUCT_NAME`, and `GITHUB_REPOSITORY_URL` from Task 1.
- Produces `MordomoHome({ locale }: { locale: Locale })` and static localized public routes.

- [x] **Step 1: Extend the message test with route-copy requirements**

```ts
it('keeps all public-language labels and CTAs in the locale dictionary', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const messages = getHomeMessages(locale);
    expect(messages.languageOptions).toHaveLength(5);
    expect(messages.hero.primaryCta.href).toBe('/chat');
    expect(messages.hero.secondaryCta.href).toBe('/staff');
    expect(messages.footer).toContain(PRODUCT_NAME);
  }
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run tests/i18n/home-messages.test.ts`

Expected: FAIL because the route-facing message fields do not exist yet.

- [x] **Step 3: Implement the shared presentation component and routes**

```tsx
export function MordomoHome({ locale }: { locale: Locale }) {
  const messages = getHomeMessages(locale);

  return (
    <main lang={locale} className="min-h-dvh overflow-hidden bg-[#f4f7f5] text-[#102421]">
      {/* branded navigation, language selector, thesis, real architecture diagram,
          capability map, grounded-answer proof, and product-status closing */}
    </main>
  );
}
```

Preserve the page's evergreen architecture visual language but make its signature element a compact **“From question to accountable answer”** operating diagram: a visitor question connects to one fast secretary path and two clearly bounded back-office paths. It must state why one agent handles the visitor path while second passes are reserved for document verification and weekly reporting. Keep the organization focus honest: cite the fictional church only as one reusable demo preset. Add a visible language selector with `/`, `/pt`, `/es`, `/fr`, and `/de` targets and an `aria-label` drawn from the dictionary.

Make `/` render `<MordomoHome locale="en" />`. Make `src/app/[locale]/page.tsx` validate `params.locale` with `parseLocale`, call `notFound()` on invalid values, export `generateStaticParams()` for the four non-English routes, and use `generateMetadata()` to set localized title and description. Update root metadata to MORDOMO's English metadata. All GitHub links use `GITHUB_REPOSITORY_URL`; do not leave an old `ChurchChatBoxV2` URL in source code.

- [x] **Step 4: Run the focused test and typecheck**

Run: `npx vitest run tests/i18n/home-messages.test.ts && npm run typecheck`

Expected: PASS. TypeScript reports no invalid locale, metadata, or JSX errors.

- [x] **Step 5: Browser-smoke the five public routes**

Run: `npm run dev -- --port 3101`

Open `/`, `/pt`, `/es`, `/fr`, and `/de`. For each route, confirm the document title is localized, the MORDOMO mark is visible, the language selector reaches the other routes, CTAs remain actionable, and the page has no horizontal overflow at desktop and mobile widths. Confirm `/it` is a 404.

- [x] **Step 6: Commit the localized presentation**

```bash
git add src/app/page.tsx src/app/[locale]/page.tsx src/app/layout.tsx src/components/marketing tests/i18n
git commit -m "feat: localize Mordomo presentation"
```

### Task 3: Align active project identity, verify, and rename the remote repository

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `brain/INDEX.md`
- Modify: `brain/status.md`
- Modify: `brain/handoff.md`
- Modify: `brain/log/decisions/2026-Q3.md`
- Modify: `docs/superpowers/specs/2026-08-25-ai-secretary-saas-beta-design.md`

**Interfaces:**
- Consumes the committed product identity and locale routes from Tasks 1–2.
- Produces active technical documentation and package metadata whose current identity is MORDOMO, plus a GitHub repository renamed to `RafaelPupio/MORDOMO`.

- [x] **Step 1: Update current identity only, preserving historical records**

Change the npm package name to `mordomo`. Update the current README, project rules, brain index, status, handoff, and active SaaS beta design to name MORDOMO as an organization-focused AI secretary. Keep the original V1 relationship explicit: MORDOMO is the V2 successor and V1 remains church-focused. Preserve old implementation plans and historical decision logs as records; do not rewrite past technical history merely to remove an old label.

- [x] **Step 2: Add a decision-log entry**

Append one concise Q3 decision stating that the V2 product identity is MORDOMO, public marketing is localized in five languages, the Vercel project remains `churchchatboxv2` as deployment infrastructure, and V1 stays separate.

- [x] **Step 3: Run the complete local verification suite**

Run: `npm test && npm run typecheck && npm run build`

Expected: all tests pass, TypeScript emits no errors, and Next.js builds the five public presentation routes.

- [x] **Step 4: Commit active identity and delivery state**

```bash
git add package.json package-lock.json README.md CLAUDE.md brain docs/superpowers/specs/2026-08-25-ai-secretary-saas-beta-design.md
git commit -m "chore: rename V2 product to Mordomo"
```

- [x] **Step 5: Rename the authorized GitHub repository and update origin**

Run:

```bash
gh repo rename MORDOMO --repo RafaelPupio/<former-v2-repository>
git remote set-url origin git@github.com:RafaelPupio/MORDOMO.git
git push -u origin codex/ai-secretary-saas-beta
```

Expected: GitHub redirects the previous repository URL, `git remote -v` shows the MORDOMO URL, and the beta branch is available on the renamed repository. Do not rename the Vercel project or move either local worktree; those names are deployment and workspace infrastructure, not user-facing product identity.

- [x] **Step 6: Record the final state and push it**

Update `brain/status.md` and `brain/handoff.md` with the rebrand/localization result and the next beta action (Clerk Organizations + trusted context). Commit that record, push it to the renamed origin, and report the five local URLs plus the GitHub URL.
