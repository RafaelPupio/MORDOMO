import {
  boolean, index, integer, jsonb, pgTable, real, text, timestamp, unique, uniqueIndex, uuid, vector,
} from 'drizzle-orm/pg-core';

export const churches = pgTable('churches', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  churchId: uuid('church_id').notNull().references(() => churches.id),
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
  churchId: uuid('church_id').notNull().references(() => churches.id),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  seq: integer('seq').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
}, (t) => [index('chunks_church_idx').on(t.churchId)]);
// No vector index: demo-scale corpora (hundreds of chunks) are fine with exact scans.

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  churchId: uuid('church_id').notNull().references(() => churches.id),
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
  churchId: uuid('church_id').notNull().references(() => churches.id),
  channel: text('channel').notNull().default('web'),
  visitorKey: text('visitor_key').notNull(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  churchId: uuid('church_id').notNull().references(() => churches.id),
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
  churchId: uuid('church_id').notNull().references(() => churches.id),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  name: text('name'),
  request: text('request').notNull(),
  status: text('status').notNull().default('new'), // Plan 3: inbox workflow
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  churchId: uuid('church_id').notNull().references(() => churches.id),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  topic: text('topic').notNull(),
  status: text('status').notNull().default('open'), // Plan 3: inbox workflow
  suggestedReply: text('suggested_reply'), // Plan 3: AI-suggested replies
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const usageLedger = pgTable('usage_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  churchId: uuid('church_id').notNull().references(() => churches.id),
  feature: text('feature').notNull(), // e.g. 'chat.reply', 'chat.retrieval', 'ingest.embed'
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const budgets = pgTable('budgets', {
  churchId: uuid('church_id').primaryKey().references(() => churches.id),
  monthlyUsd: real('monthly_usd').notNull(),
});

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start').notNull(),
  count: integer('count').notNull(),
});

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  churchId: uuid('church_id').notNull().references(() => churches.id),
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  findings: jsonb('findings').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [unique('reports_church_period_key').on(t.churchId, t.periodStart)]);
