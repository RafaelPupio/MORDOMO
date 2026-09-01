import { sql } from 'drizzle-orm';
import {
  boolean, check, index, integer, jsonb, pgTable, real, text, timestamp, unique, uniqueIndex, uuid, vector,
} from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  clerkOrganizationId: text('clerk_organization_id').unique(),
  ownerClerkUserId: text('owner_clerk_user_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const organizationProfiles = pgTable('organization_profiles', {
  organizationId: uuid('organization_id').primaryKey().references(() => organizations.id),
  industry: text('industry').notNull(),
  defaultLocale: text('default_locale').notNull(),
  assistantName: text('assistant_name').notNull(),
  replyTone: text('reply_tone').notNull(),
  greeting: text('greeting').notNull(),
  escalationCopy: text('escalation_copy').notNull(),
  enabledCapabilities: jsonb('enabled_capabilities').$type<string[]>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const personalContexts = pgTable('personal_contexts', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const secretaryProfileVersions = pgTable('secretary_profile_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  status: text('status').notNull().default('draft'),
  profile: jsonb('profile').$type<unknown>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('secretary_profile_versions_organization_created_at_idx').on(t.organizationId, t.createdAt.desc()),
  uniqueIndex('secretary_profile_versions_one_published_organization')
    .on(t.organizationId)
    .where(sql`${t.status} = 'published'`),
]);

export const researchBriefs = pgTable('research_briefs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  requestedByClerkUserId: text('requested_by_clerk_user_id').notNull(),
  segment: text('segment').notNull(),
  city: text('city'),
  locale: text('locale').notNull(),
  requestedUrl: text('requested_url').notNull(),
  consentVersion: text('consent_version').notNull(),
  consentedAt: timestamp('consented_at').notNull(),
  proposalAttempts: integer('proposal_attempts').notNull().default(0),
  status: text('status').notNull().default('retrieving'),
  errorCode: text('error_code'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('research_briefs_organization_created_at_idx').on(t.organizationId, t.createdAt.desc()),
  index('research_briefs_organization_id_idx').on(t.organizationId, t.id),
  uniqueIndex('research_briefs_one_active_organization')
    .on(t.organizationId)
    .where(sql`${t.status} in ('retrieving', 'source_ready', 'proposing')`),
  check('research_briefs_segment_check', sql`${t.segment} in ('church', 'clinic', 'restaurant', 'real_estate', 'general')`),
  check('research_briefs_city_length_check', sql`${t.city} is null or char_length(${t.city}) <= 120`),
  check('research_briefs_locale_check', sql`${t.locale} in ('en', 'pt')`),
  check('research_briefs_url_length_check', sql`char_length(${t.requestedUrl}) between 1 and 2048`),
  check('research_briefs_consent_length_check', sql`char_length(${t.consentVersion}) between 1 and 80`),
  check('research_briefs_proposal_attempts_check', sql`${t.proposalAttempts} between 0 and 3`),
  check('research_briefs_status_check', sql`${t.status} in ('retrieving', 'source_ready', 'proposing', 'review_ready', 'failed', 'applied')`),
  check('research_briefs_error_code_check', sql`${t.errorCode} is null or ${t.errorCode} in ('researchUnavailable', 'forbidden', 'invalidInput', 'unsafeUrl', 'rateLimited', 'budgetExhausted', 'providerUnavailable', 'retentionUnverified', 'noUsefulContent', 'proposalFailed', 'ungroundedProposal', 'staleResearchState', 'notFound')`),
]);

export const researchSources = pgTable('research_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  briefId: uuid('brief_id').notNull().references(() => researchBriefs.id),
  url: text('url').notNull(),
  title: text('title').notNull(),
  excerpt: text('excerpt').notNull(),
  retrievedAt: timestamp('retrieved_at').notNull(),
}, (t) => [
  uniqueIndex('research_sources_one_per_brief').on(t.organizationId, t.briefId),
  index('research_sources_organization_id_idx').on(t.organizationId, t.id),
  check('research_sources_url_length_check', sql`char_length(${t.url}) between 1 and 2048`),
  check('research_sources_title_length_check', sql`char_length(${t.title}) between 1 and 200`),
  check('research_sources_excerpt_length_check', sql`char_length(${t.excerpt}) between 1 and 40000`),
]);

export const researchFacts = pgTable('research_facts', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  briefId: uuid('brief_id').notNull().references(() => researchBriefs.id),
  sourceId: uuid('source_id').notNull().references(() => researchSources.id),
  proposedText: text('proposed_text').notNull(),
  supportingQuote: text('supporting_quote').notNull(),
  reviewStatus: text('review_status').notNull().default('proposed'),
  acceptedText: text('accepted_text'),
  reviewedByClerkUserId: text('reviewed_by_clerk_user_id'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('research_facts_organization_brief_idx').on(t.organizationId, t.briefId),
  index('research_facts_organization_id_idx').on(t.organizationId, t.id),
  check('research_facts_proposed_text_length_check', sql`char_length(${t.proposedText}) between 1 and 280`),
  check('research_facts_supporting_quote_length_check', sql`char_length(${t.supportingQuote}) between 1 and 500`),
  check('research_facts_accepted_text_length_check', sql`${t.acceptedText} is null or char_length(${t.acceptedText}) between 1 and 280`),
  check('research_facts_review_status_check', sql`${t.reviewStatus} in ('proposed', 'accepted', 'rejected')`),
  check('research_facts_review_shape', sql`
    (${t.reviewStatus} = 'proposed' and ${t.acceptedText} is null and ${t.reviewedByClerkUserId} is null and ${t.reviewedAt} is null)
    or (${t.reviewStatus} = 'accepted' and ${t.acceptedText} is not null and ${t.reviewedByClerkUserId} is not null and ${t.reviewedAt} is not null)
    or (${t.reviewStatus} = 'rejected' and ${t.acceptedText} is null and ${t.reviewedByClerkUserId} is not null and ${t.reviewedAt} is not null)
  `),
]);

export const dataControlEvents = pgTable('data_control_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  actorClerkUserId: text('actor_clerk_user_id').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  outcome: text('outcome').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('data_control_events_organization_created_at_idx').on(t.organizationId, t.createdAt.desc()),
  index('data_control_events_organization_id_idx').on(t.organizationId, t.id),
  check('data_control_events_actor_length_check', sql`char_length(${t.actorClerkUserId}) between 1 and 255`),
  check('data_control_events_action_check', sql`${t.action} in ('research.started', 'research.source', 'research.proposed', 'research.reviewed', 'research.applied')`),
  check('data_control_events_target_type_check', sql`${t.targetType} in ('research_brief', 'research_fact', 'profile_version')`),
  check('data_control_events_target_id_length_check', sql`char_length(${t.targetId}) between 1 and 128`),
  check('data_control_events_outcome_check', sql`${t.outcome} in ('succeeded', 'failed')`),
]);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  title: text('title').notNull(),
  kind: text('kind').notNull(), // 'schedule' | 'bulletin' | 'ministry' | 'statute' | 'faq' | 'upload'
  sourcePath: text('source_path'),
  // Plan 2 adds the pipeline states (uploaded/parsing/extracting/verifying/published/failed
  // — src/core/ingest-status.ts). Deliberately NOT used to gate what src/core/retrieval.ts
  // serves: a document's chunks go live at the `extracting` transition (as soon as they're
  // written — src/core/ingest.ts), not at `published`, so search stays correct through a
  // later stage failing. See the comment on `searchKnowledgeBase` for the full reasoning.
  ingestStatus: text('ingest_status').notNull().default('published'),
  ingestError: text('ingest_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const chunks = pgTable('chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  seq: integer('seq').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
}, (t) => [index('chunks_organization_idx').on(t.organizationId)]);
// No vector index: demo-scale corpora (hundreds of chunks) are fine with exact scans.

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  title: text('title').notNull(),
  startsAt: timestamp('starts_at').notNull(),
  location: text('location'),
  description: text('description'),
  verified: boolean('verified').notNull().default(false), // Plan 2: verifier agent flips this
  sourceDocumentId: uuid('source_document_id').references(() => documents.id),
  extractionConfidence: real('extraction_confidence'),
  verificationNote: text('verification_note'),
  sourceQuote: text('source_quote'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey(), // client-supplied UUID
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  channel: text('channel').notNull().default('web'),
  visitorKey: text('visitor_key').notNull(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
  seq: integer('seq').notNull().generatedAlwaysAsIdentity(),
  role: text('role').notNull(), // 'user' | 'assistant'
  parts: jsonb('parts').notNull(), // AI SDK UIMessage parts (text, tool calls with citations)
  // The client-supplied message id (NOT a uuid — the AI SDK's default id generator is a
  // 16-char alphanumeric string, so this cannot reuse `id`, which stays a server-generated
  // uuid). Lets saveMessage make the user-message write idempotent across retries of the
  // same turn (regenerate() resends the same history, same id) without trusting the client
  // id to be globally unique — the uniqueness check below is scoped to the conversation, so
  // a colliding/malicious id from a different conversation can never suppress a write here.
  // Nullable: assistant-authored rows never carry one.
  clientMessageId: text('client_message_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  // A plain (non-partial) unique index still lets multiple rows share a NULL
  // clientMessageId (Postgres treats NULLs as distinct for uniqueness), so this only
  // constrains rows that actually carry a client id — exactly the ones the idempotency
  // guard above needs.
  uniqueIndex('messages_conversation_client_id_idx').on(t.conversationId, t.clientMessageId),
]);

export const prayerRequests = pgTable('prayer_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  name: text('name'),
  request: text('request').notNull(),
  status: text('status').notNull().default('new'), // Plan 3: inbox workflow
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  topic: text('topic').notNull(),
  status: text('status').notNull().default('open'), // Plan 3: inbox workflow
  suggestedReply: text('suggested_reply'), // Plan 3: AI-suggested replies
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const usageLedger = pgTable('usage_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  feature: text('feature').notNull(), // e.g. 'chat.reply', 'chat.retrieval', 'ingest.embed'
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const budgets = pgTable('budgets', {
  organizationId: uuid('organization_id').primaryKey().references(() => organizations.id),
  monthlyUsd: real('monthly_usd').notNull(),
});

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start').notNull(),
  count: integer('count').notNull(),
});

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  findings: jsonb('findings').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [unique('reports_organization_period_key').on(t.organizationId, t.periodStart)]);
