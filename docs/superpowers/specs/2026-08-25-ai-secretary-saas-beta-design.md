# AI Secretary SaaS Beta — Design

**Date:** 2026-08-25
**Status:** Approved for planning
**Scope:** Invite-only multi-workspace beta; no checkout or billing implementation.

## Goal

Evolve ChurchChatBox V2 from a single fictional church demo into a configurable, multilingual AI Secretary that real beta clients can access through isolated organization workspaces. Igreja da Colina remains a seeded church preset and portfolio example; it is no longer the product's only domain.

The beta proves onboarding, configuration, grounded public chat, staff workflows, and tenant isolation before pricing or payment collection. English remains available alongside Portuguese, Spanish, French, and German.

## Product boundaries

The beta includes:

- Invite-only sign-in, organization membership, and roles.
- A saved organization profile that changes the public interface and agent behavior.
- A shareable public secretary URL for each organization.
- Localized portfolio, onboarding, visitor chat, and staff interface copy.
- Existing knowledge retrieval, citations, calendar information, contact escalation, document ingest, usage controls, staff review, and reporting.

The beta explicitly excludes checkout, subscriptions, invoices, phone/SMS, outbound messaging, appointment booking, and any capability that has no working integration. The product must never imply that a task is available merely because an industry preset would commonly need it.

## Integration choices

- **Authentication and membership:** Clerk, provisioned through the Vercel Marketplace. Clerk Organizations supplies sign-in, invitations, workspace membership, and owner/admin/member roles.
- **Database:** existing Neon Postgres. Application-owned organization data remains in Neon and maps one-to-one to a Clerk Organization ID.
- **Billing:** Stripe is the future subscription provider, also through the Vercel Marketplace. It is not provisioned or implemented in the beta because pricing and paid-plan limits are intentionally deferred.
- **AI:** the existing Vercel AI Gateway integration remains the only model path. Tests use mocks and must not consume gateway credit.

## Data model and migration

The application domain changes from `church` to `organization` throughout schema, repositories, prompts, route variables, usage keys, and tests. PostgreSQL migrations rename the existing `churches` table and every `church_id` column to organization equivalents; IDs and rows remain intact. This preserves the seeded Igreja da Colina data while making tenant language truthful.

New organization fields:

- `clerk_organization_id` (unique, nullable only during seeded-data migration)
- `slug` and `name`
- `industry` (preset identifier)
- `default_locale`
- `assistant_name`
- `reply_tone`
- `greeting`
- `escalation_copy`
- `enabled_capabilities` (validated JSON/enum set)
- timestamps

A dedicated `organization_profiles` table is preferred if these settings grow beyond a compact profile; otherwise the migration keeps the fields on `organizations` and exposes them through one typed profile module. Each remaining record (`documents`, `chunks`, `events`, `conversations`, `messages`, confidential requests, tickets, usage, budgets, and reports) references `organization_id`.

The seed creates the Igreja da Colina organization as a church preset and maps it to a Clerk development organization only after the account integration is provisioned. No existing staff cookie is accepted after the migration.

## Access and tenancy

Clerk replaces the shared password and HMAC staff cookie. The middleware protects onboarding, studio, staff routes, mutations, ingest, and organization-specific APIs. Server-side helpers resolve the authenticated Clerk user and active Clerk Organization, load the matching Neon organization, and derive the organization ID only from that trusted context.

Public visitor chat is deliberately separate from staff identity. Its route includes a server-validated organization slug, for example `/{locale}/o/{slug}/chat`. The handler resolves the slug once, uses that organization for rate limits and budgets, and never accepts an organization ID from the browser. Conversation history remains bound to the visitor cookie and the resolved organization.

Roles:

- **Owner:** organization settings, invitations, profile, documents, reports, and staff workflows.
- **Admin:** all operational staff functions except ownership/invitation administration.
- **Member:** operational inbox and document work permitted by the selected beta policy.

The public marketing site and localized public secretary pages are unauthenticated. Invite-only beta enrollment uses Clerk invitations; no anonymous workspace creation is exposed.

## Secretary Studio

`/studio` is an authenticated owner/admin workspace. It saves the organization profile and offers a preview of the public secretary without making an AI request. Controls include organization name, industry preset, assistant name, default language, greeting, tone, escalation wording, and supported capabilities.

Presets adapt copy and capability labels without inventing integrations. The church preset can enable a confidential prayer-request workflow. Other presets use the generic confidential-request or contact-intake language. All profiles retain grounded knowledge search, calendar information when source events exist, human escalation, citations, and staff approval.

The live secretary prompt accepts a typed organization profile. It identifies the organization and assistant, instructs the selected tone and language behavior, describes only enabled tools, grounds factual claims in retrieved sources, and directs uncertainty to human escalation. Tool schemas and descriptions become neutral (organization, event, confidential request, staff) while the data boundary remains identical.

## Localization

Supported locale codes are `en`, `pt`, `es`, `fr`, and `de`. The default English marketing route remains `/`; locale-prefixed routes are `/pt`, `/es`, `/fr`, and `/de`. Their nested routes cover portfolio, onboarding, public chat, studio, and staff UI.

Typed in-repository dictionaries provide all interface text; no localization SaaS or runtime translation service is introduced. Locale validation fails safely to English. `lang`, metadata, navigation links, date/number formatting, labels, empty states, forms, and errors are localized. Stored organization data and source documents are never machine-translated at rest. The secretary continues to answer in the visitor's language and may translate retrieved Portuguese information naturally, with citations retained.

## Routes and user journey

1. A beta owner receives a Clerk invitation, signs in, and selects or creates the invited organization.
2. Onboarding collects the profile and exposes Secretary Studio.
3. The owner saves the profile and gets the localized public URL.
4. A visitor opens `/{locale}/o/{slug}/chat`, asks a question, and receives a grounded, cited answer or a transparent escalation.
5. Staff sign in, choose the organization, and operate the localized dashboard; all queries and writes are scoped through trusted server context.

## Billing posture

Every beta organization has a `beta` entitlement set by the invite workflow, not a paid subscription. Feature gates are centralized behind an entitlement interface so Stripe can later map paid plans without reworking authorization. No Stripe product, checkout session, payment form, webhook, or pricing promise is created in this work.

The future commercial hypothesis is: free 30-day Founding Beta, then $39/month Secretary, $99/month Team Secretary, and $199/month Office Secretary. Usage is measured as an AI conversation rather than an individual message. Voice/SMS and booking are separate future add-ons because their underlying costs are usage-based.

## Security and reliability

- All server mutations derive organization identity from Clerk and verify the corresponding Neon organization; client-provided IDs cannot switch tenants.
- Invitations and role checks are enforced before settings, staff, document, and reporting actions.
- Existing rate limits, budget gates, source citations, file validation, and safe Markdown rendering remain in place under organization-scoped keys.
- Capability flags are validated server-side and are interpolated into prompts as controlled values, never raw client instruction text.
- Migrations preserve existing IDs and use backup-safe, reversible rename steps; migration verification confirms record counts and foreign-key integrity.

## Verification

- Unit tests cover locale selection/fallback, profile validation, entitlement checks, prompt construction, role gates, and tool availability.
- Repository and API tests prove every organization query/write remains scoped, including forged form/API inputs and public chat slug validation.
- Migration tests or a disposable Neon branch verify preserved data and renamed foreign keys.
- Browser smoke tests cover the five localized entry points, invitation/sign-in boundaries, profile save and refresh, public chat rendering, staff routing, and English fallback.
- AI calls are mocked for automated testing. After deployment configuration is complete, run one controlled live chat smoke test, read its usage ledger cost, and stop.

## Rollout sequence

1. Provision Clerk development integration and configure invite-only enrollment.
2. Implement organization migration and trusted Clerk-to-Neon context boundary.
3. Generalize profiles, prompts, tools, and current routes while keeping the church preset passing.
4. Add locale routing and dictionaries across marketing, chat, studio, and staff surfaces.
5. Add onboarding and Secretary Studio with profile persistence and preview.
6. Complete automated verification, perform one controlled live smoke test, then publish the invite-only beta.
