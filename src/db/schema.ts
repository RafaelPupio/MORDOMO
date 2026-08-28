import { sql } from 'drizzle-orm';
import {
  boolean, index, integer, jsonb, pgTable, real, text, timestamp, unique, uniqueIndex, uuid, vector,
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
