# Plan 1: Foundation + Chat Vertical Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stranger can open the deployed URL, chat with the fictional church's AI secretary in any language, and get fast answers grounded in the church's documents with visible citations — with every LLM call metered and capped.

**Architecture:** Next.js App Router on Vercel with a channel-agnostic chat core: the web route is a thin adapter over `runSecretary()`, a single tool-using agent (search knowledge base, calendar, prayer requests, human escalation). Retrieval is pgvector cosine search over chunked, embedded seed documents in Neon Postgres. Every table is tenant-keyed (`church_id`); every LLM/embedding call lands in `usage_ledger`; per-visitor rate limits + per-tenant and global budget caps guard the public demo.

**Tech Stack:** Next.js (App Router, TypeScript, Tailwind), Drizzle ORM + drizzle-kit, Neon Postgres + pgvector, AI SDK v6 via Vercel AI Gateway (plain model strings), Vitest, PGlite (+ vector extension) for tests, tsx for scripts.

This is **Plan 1 of 4** (2: document ingest pipeline; 3: staff operations; 4: reporting + portfolio shell). Spec: `docs/superpowers/specs/2026-08-18-churchchatbox-v2-design.md`.

## Global Constraints

- Every table carries `church_id`; every query is tenant-scoped. No exceptions.
- Every LLM/embedding call is recorded in `usage_ledger` (tokens + cost, per tenant, per feature).
- Models: `anthropic/claude-sonnet-5` (chat), `anthropic/claude-haiku-4-5` (background), embeddings `openai/text-embedding-3-small` (1536 dims) — all via Vercel AI Gateway plain strings; constants live in `src/ai/pricing.ts` only.
- Node runtime only — never `runtime = 'edge'`.
- Public repo: no secrets, no `.env*` committed, fictional data only ("Igreja da Colina" — always with a fictional-demo disclaimer in UI).
- Cost target $10–50/mo: rate limits and budget caps are launch scope, not polish.
- Code, comments, docs: English. Church-facing content: Portuguese.
- All scheduled work is Vercel Cron (cloud) — no local schedulers.

---

### Task 1: Scaffold Next.js app and test tooling

**Files:**
- Create: Next.js scaffold (via create-next-app), `vitest.config.ts`, `.env.example`
- Modify: `.gitignore`, `package.json` (scripts)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a building Next.js app with `npm test`, `npm run typecheck`, path alias `@/*` → `src/*`. All later tasks assume these exist.

- [ ] **Step 1: Scaffold into a temp dir and merge** (create-next-app refuses non-empty dirs; repo already has brain/, docs/, CLAUDE.md)

```bash
cd ~/Desktop/Tech/ChurchChatBoxV2
npx create-next-app@latest .scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --turbopack
rsync -a .scaffold/ ./
rm -rf .scaffold
```

- [ ] **Step 2: Install dependencies**

```bash
npm install ai @ai-sdk/react zod drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit vitest @electric-sql/pglite tsx dotenv
```

- [ ] **Step 3: Restore the curated `.gitignore`** (create-next-app overwrote it). Full content:

```gitignore
# Secrets — this repo is public; nothing sensitive ever enters it
.env
.env.*
!.env.example

# Dependencies & build
node_modules/
.next/
.vercel/
out/
*.tsbuildinfo
next-env.d.ts

# OS / editor
.DS_Store
.obsidian/
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
```

- [ ] **Step 5: Add scripts to `package.json`** (merge into existing `scripts` block)

```json
{
  "test": "vitest run",
  "typecheck": "tsc --noEmit",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "seed": "tsx scripts/seed.ts"
}
```

- [ ] **Step 6: Create `.env.example`**

```bash
# Neon Postgres (pooled connection string)
DATABASE_URL=
# Vercel AI Gateway key (Vercel dashboard → AI Gateway)
AI_GATEWAY_API_KEY=
# Global monthly demo cap in USD (all tenants combined)
DEMO_GLOBAL_MONTHLY_USD_CAP=50
```

- [ ] **Step 7: Verify build and empty test run**

Run: `npm run typecheck && npm run build && npm test`
Expected: typecheck clean; build succeeds; vitest reports "no test files found" (exit 0 — if it exits 1 on empty, add `passWithNoTests: true` to the vitest config `test` block).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app with vitest, drizzle, AI SDK toolchain"
```

---

### Task 2: Neon project, database schema, migrations, PGlite test harness

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`, `tests/helpers/db.ts`, `tests/db/schema.test.ts`, `drizzle/` (generated)

**Interfaces:**
- Consumes: Task 1 toolchain.
- Produces: all Drizzle table objects exported from `@/db/schema` (`churches`, `documents`, `chunks`, `events`, `conversations`, `messages`, `prayerRequests`, `tickets`, `usageLedger`, `budgets`, `rateLimits`); `getDb(): Db` and `type Db` from `@/db/client`; `createTestDb(): Promise<Db>` and `seedChurch(db, name?)` from `tests/helpers/db`.

- [ ] **Step 1: Create the Neon project (dev database)**

```bash
neonctl projects create --name churchchatboxv2 --output json
```

Take `connection_uris[0].connection_uri` from the output and write it as `DATABASE_URL` into `.env.local` (gitignored). If `neonctl` is missing or unauthenticated (`neonctl auth` needs a browser), STOP and report — Rafael must authenticate or create the project in the Neon dashboard; do not improvise another database.

- [ ] **Step 2: Create `drizzle.config.ts`**

```ts
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.local' });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 3: Write `src/db/schema.ts`**

```ts
import {
  boolean, index, integer, jsonb, pgTable, real, text, timestamp, uuid, vector,
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
  ingestStatus: text('ingest_status').notNull().default('published'), // Plan 2 adds the pipeline states
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

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
```

- [ ] **Step 4: Write `src/db/client.ts`**

```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

// Driver-agnostic handle: production uses neon-http, tests use PGlite.
export type Db = PgDatabase<PgQueryResultHKT>;

let _db: Db | null = null;

export function getDb(): Db {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _db = drizzle(neon(url)) as unknown as Db;
  }
  return _db;
}
```

- [ ] **Step 5: Generate the migration and add the pgvector extension line**

```bash
npm run db:generate
```

Then edit the generated `drizzle/0000_*.sql`: add this as the FIRST line of the file:

```sql
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
```

- [ ] **Step 6: Write `tests/helpers/db.ts`**

```ts
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Db } from '@/db/client';
import { churches } from '@/db/schema';

export async function createTestDb(): Promise<Db> {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: 'drizzle' });
  return db as unknown as Db;
}

export async function seedChurch(db: Db, name = 'Igreja Teste') {
  const [row] = await db
    .insert(churches)
    .values({ slug: `t-${crypto.randomUUID().slice(0, 8)}`, name })
    .returning();
  return row;
}
```

- [ ] **Step 7: Write the failing test `tests/db/schema.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { chunks, churches } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

describe('schema + migrations', () => {
  it('applies migrations to PGlite and round-trips a church', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db, 'Igreja Alpha');
    const rows = await db.select().from(churches);
    expect(rows.map((r) => r.id)).toContain(church.id);
  });

  it('stores and reads a 1536-dim vector', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const { documents } = await import('@/db/schema');
    const [doc] = await db
      .insert(documents)
      .values({ churchId: church.id, title: 'Doc', kind: 'faq' })
      .returning();
    const embedding = Array.from({ length: 1536 }, () => 0.1);
    await db.insert(chunks).values({ churchId: church.id, documentId: doc.id, seq: 0, content: 'hello', embedding });
    const stored = await db.select().from(chunks);
    expect(stored[0].embedding).toHaveLength(1536);
  });
});
```

- [ ] **Step 8: Run tests to verify they pass** (migration was generated in step 5; failures here mean the SQL or harness is wrong)

Run: `npx vitest run tests/db/schema.test.ts`
Expected: 2 passing.

- [ ] **Step 9: Apply the migration to Neon**

Run: `npm run db:migrate`
Expected: completes without error.

- [ ] **Step 10: Typecheck and commit**

```bash
npm run typecheck
git add -A && git commit -m "feat(db): tenant-keyed schema with pgvector, Neon migrations, PGlite test harness"
```

---

### Task 3: Pricing, usage ledger, budget guard

**Files:**
- Create: `src/ai/pricing.ts`, `src/ai/usage.ts`, `tests/ai/usage.test.ts`

**Interfaces:**
- Consumes: `Db`, `usageLedger`, `budgets`, test harness.
- Produces: from `@/ai/pricing`: `CHAT_MODEL`, `FAST_MODEL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `costUsd(model, inputTokens, outputTokens): number`. From `@/ai/usage`: `recordUsage(db, { churchId, feature, model, inputTokens, outputTokens }): Promise<void>`, `monthSpendUsd(db, churchId?): Promise<number>`, `checkBudget(db, churchId, globalCapUsd): Promise<BudgetStatus>` with `type BudgetStatus = { allowed: boolean; reason?: 'tenant' | 'global' }`.

- [ ] **Step 1: Write the failing tests `tests/ai/usage.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { CHAT_MODEL, costUsd } from '@/ai/pricing';
import { checkBudget, monthSpendUsd, recordUsage } from '@/ai/usage';
import { budgets } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

describe('pricing', () => {
  it('computes cost from the price table', () => {
    // Sonnet assumption: $3/M input, $15/M output
    expect(costUsd(CHAT_MODEL, 1_000_000, 1_000_000)).toBeCloseTo(18);
    expect(costUsd(CHAT_MODEL, 0, 0)).toBe(0);
  });

  it('throws on unknown model', () => {
    expect(() => costUsd('unknown/model', 1, 1)).toThrow(/no price/i);
  });
});

describe('usage ledger + budget', () => {
  it('records usage and sums the month per tenant', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    await recordUsage(db, { churchId: a.id, feature: 'chat.reply', model: CHAT_MODEL, inputTokens: 1_000_000, outputTokens: 0 });
    await recordUsage(db, { churchId: b.id, feature: 'chat.reply', model: CHAT_MODEL, inputTokens: 0, outputTokens: 1_000_000 });
    expect(await monthSpendUsd(db, a.id)).toBeCloseTo(3);
    expect(await monthSpendUsd(db)).toBeCloseTo(18); // global = both tenants
  });

  it('fails closed when the tenant has no budget row', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db);
    expect(await checkBudget(db, a.id, 50)).toEqual({ allowed: false, reason: 'tenant' });
  });

  it('blocks when tenant budget is spent, allows under budget', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db);
    await db.insert(budgets).values({ churchId: a.id, monthlyUsd: 10 });
    expect((await checkBudget(db, a.id, 50)).allowed).toBe(true);
    await recordUsage(db, { churchId: a.id, feature: 'chat.reply', model: CHAT_MODEL, inputTokens: 0, outputTokens: 1_000_000 }); // $15
    expect(await checkBudget(db, a.id, 50)).toEqual({ allowed: false, reason: 'tenant' });
  });

  it('blocks on the global cap even when the tenant has budget left', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    await db.insert(budgets).values({ churchId: a.id, monthlyUsd: 100 });
    await recordUsage(db, { churchId: b.id, feature: 'chat.reply', model: CHAT_MODEL, inputTokens: 0, outputTokens: 1_000_000 }); // $15 global
    expect(await checkBudget(db, a.id, 10)).toEqual({ allowed: false, reason: 'global' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ai/usage.test.ts`
Expected: FAIL — cannot resolve `@/ai/pricing`.

- [ ] **Step 3: Write `src/ai/pricing.ts`**

```ts
export const CHAT_MODEL = 'anthropic/claude-sonnet-5';
export const FAST_MODEL = 'anthropic/claude-haiku-4-5';
export const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

// USD per 1M tokens. Assumptions recorded in brain/log/decisions.md — adjust when real
// gateway invoices are observed.
const PRICES: Record<string, { inPerM: number; outPerM: number }> = {
  [CHAT_MODEL]: { inPerM: 3, outPerM: 15 },
  [FAST_MODEL]: { inPerM: 1, outPerM: 5 },
  [EMBEDDING_MODEL]: { inPerM: 0.02, outPerM: 0 },
};

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  if (!p) throw new Error(`No price configured for model ${model}`);
  return (inputTokens * p.inPerM + outputTokens * p.outPerM) / 1_000_000;
}
```

- [ ] **Step 4: Write `src/ai/usage.ts`**

```ts
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { budgets, usageLedger } from '@/db/schema';
import { costUsd } from './pricing';

export type UsageInput = {
  churchId: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type BudgetStatus = { allowed: boolean; reason?: 'tenant' | 'global' };

export async function recordUsage(db: Db, input: UsageInput): Promise<void> {
  await db.insert(usageLedger).values({
    ...input,
    costUsd: costUsd(input.model, input.inputTokens, input.outputTokens),
  });
}

export async function monthSpendUsd(db: Db, churchId?: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const conds = [gte(usageLedger.createdAt, start)];
  if (churchId) conds.push(eq(usageLedger.churchId, churchId));
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(and(...conds));
  return Number(row.total);
}

export async function checkBudget(db: Db, churchId: string, globalCapUsd: number): Promise<BudgetStatus> {
  const [budget] = await db.select().from(budgets).where(eq(budgets.churchId, churchId));
  if (!budget) return { allowed: false, reason: 'tenant' }; // fail closed on the public demo
  if ((await monthSpendUsd(db, churchId)) >= budget.monthlyUsd) return { allowed: false, reason: 'tenant' };
  if ((await monthSpendUsd(db)) >= globalCapUsd) return { allowed: false, reason: 'global' };
  return { allowed: true };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/ai/usage.test.ts`
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ai): model pricing table, usage ledger, fail-closed budget guard"
```

---

### Task 4: Rate limiter

**Files:**
- Create: `src/core/rate-limit.ts`, `tests/core/rate-limit.test.ts`

**Interfaces:**
- Consumes: `Db`, `rateLimits` table.
- Produces: `checkRateLimit(db, key, { limit, windowSeconds, now? }): Promise<RateLimitResult>` with `type RateLimitResult = { allowed: boolean; remaining: number }` from `@/core/rate-limit`.

- [ ] **Step 1: Write the failing tests `tests/core/rate-limit.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { checkRateLimit } from '@/core/rate-limit';
import { createTestDb } from '../helpers/db';

describe('checkRateLimit', () => {
  it('allows up to the limit within a window, then blocks', async () => {
    const db = await createTestDb();
    const now = new Date('2026-08-19T12:00:00Z');
    const opts = { limit: 3, windowSeconds: 600, now };
    expect((await checkRateLimit(db, 'chat:1.2.3.4', opts)).allowed).toBe(true);
    expect((await checkRateLimit(db, 'chat:1.2.3.4', opts)).allowed).toBe(true);
    const third = await checkRateLimit(db, 'chat:1.2.3.4', opts);
    expect(third).toEqual({ allowed: true, remaining: 0 });
    expect((await checkRateLimit(db, 'chat:1.2.3.4', opts)).allowed).toBe(false);
  });

  it('resets when the window rolls over', async () => {
    const db = await createTestDb();
    const opts = { limit: 1, windowSeconds: 600 };
    await checkRateLimit(db, 'k', { ...opts, now: new Date('2026-08-19T12:00:00Z') });
    const next = await checkRateLimit(db, 'k', { ...opts, now: new Date('2026-08-19T12:10:01Z') });
    expect(next.allowed).toBe(true);
  });

  it('tracks keys independently', async () => {
    const db = await createTestDb();
    const now = new Date('2026-08-19T12:00:00Z');
    await checkRateLimit(db, 'a', { limit: 1, windowSeconds: 600, now });
    expect((await checkRateLimit(db, 'b', { limit: 1, windowSeconds: 600, now })).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/rate-limit.test.ts`
Expected: FAIL — cannot resolve `@/core/rate-limit`.

- [ ] **Step 3: Write `src/core/rate-limit.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { rateLimits } from '@/db/schema';

export type RateLimitResult = { allowed: boolean; remaining: number };

// Fixed-window counter in Postgres. Read-modify-write: a concurrent race can
// undercount slightly, which is acceptable for demo-scale abuse control.
export async function checkRateLimit(
  db: Db,
  key: string,
  opts: { limit: number; windowSeconds: number; now?: Date },
): Promise<RateLimitResult> {
  const now = opts.now ?? new Date();
  const windowMs = opts.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  const [existing] = await db.select().from(rateLimits).where(eq(rateLimits.key, key));
  const count =
    existing && existing.windowStart.getTime() === windowStart.getTime() ? existing.count + 1 : 1;

  await db
    .insert(rateLimits)
    .values({ key, windowStart, count })
    .onConflictDoUpdate({ target: rateLimits.key, set: { windowStart, count } });

  return { allowed: count <= opts.limit, remaining: Math.max(0, opts.limit - count) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/rate-limit.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): postgres-backed fixed-window rate limiter"
```

---

### Task 5: Markdown chunker

**Files:**
- Create: `src/core/chunking.ts`, `tests/core/chunking.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `chunkMarkdown(text: string): Chunk[]` with `type Chunk = { seq: number; content: string }` from `@/core/chunking`.

- [ ] **Step 1: Write the failing tests `tests/core/chunking.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '@/core/chunking';

describe('chunkMarkdown', () => {
  it('keeps a short document as a single chunk', () => {
    const out = chunkMarkdown('# Title\n\nShort body.');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ seq: 0, content: '# Title\n\nShort body.' });
  });

  it('splits on h2 sections', () => {
    const doc = '# Doc\n\nIntro.\n\n## Horários\n\nDomingo 10h.\n\n## Endereço\n\nRua X, 123.';
    const out = chunkMarkdown(doc);
    expect(out.length).toBe(3);
    expect(out[1].content).toContain('Horários');
    expect(out[2].content).toContain('Endereço');
  });

  it('splits an oversized section by paragraphs under the max size', () => {
    const para = 'palavra '.repeat(100).trim(); // ~800 chars
    const doc = `## Grande\n\n${para}\n\n${para}\n\n${para}`;
    const out = chunkMarkdown(doc);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.content.length).toBeLessThanOrEqual(1500);
  });

  it('assigns sequential seq starting at 0', () => {
    const doc = '## A\n\nx.\n\n## B\n\ny.';
    expect(chunkMarkdown(doc).map((c) => c.seq)).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/chunking.test.ts`
Expected: FAIL — cannot resolve `@/core/chunking`.

- [ ] **Step 3: Write `src/core/chunking.ts`**

```ts
export type Chunk = { seq: number; content: string };

const MAX_CHUNK_CHARS = 1500;

// Heading-aware chunking: split on h2 boundaries so a chunk stays a coherent topic
// (a schedule, an address), then split oversized sections by paragraph groups.
export function chunkMarkdown(text: string): Chunk[] {
  const sections = text.split(/\n(?=## )/);
  const pieces: string[] = [];

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    if (trimmed.length <= MAX_CHUNK_CHARS) {
      pieces.push(trimmed);
      continue;
    }
    let current = '';
    for (const para of trimmed.split(/\n\n+/)) {
      if (current && current.length + para.length + 2 > MAX_CHUNK_CHARS) {
        pieces.push(current.trim());
        current = para;
      } else {
        current = current ? `${current}\n\n${para}` : para;
      }
    }
    if (current.trim()) pieces.push(current.trim());
  }

  return pieces.map((content, seq) => ({ seq, content }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/chunking.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): heading-aware markdown chunker"
```

---

### Task 6: Embedder interface (gateway + deterministic fake)

**Files:**
- Create: `src/ai/embedder.ts`, `tests/ai/embedder.test.ts`

**Interfaces:**
- Consumes: `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` from `@/ai/pricing`.
- Produces: from `@/ai/embedder`: `interface Embedder { readonly model: string; embed(texts: string[]): Promise<EmbedResult> }` with `type EmbedResult = { embeddings: number[][]; tokens: number }`; `class GatewayEmbedder implements Embedder` (real, via AI Gateway); `class HashEmbedder implements Embedder` (deterministic bag-of-words fake for tests/offline seed — similar texts get similar vectors).

- [ ] **Step 1: Write the failing tests `tests/ai/embedder.test.ts`** (HashEmbedder only — GatewayEmbedder is a thin wrapper over the AI SDK, exercised in deploy verification)

```ts
import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are unit-normalized
}

describe('HashEmbedder', () => {
  it('is deterministic and unit-normalized at 1536 dims', async () => {
    const e = new HashEmbedder();
    const { embeddings } = await e.embed(['culto de domingo', 'culto de domingo']);
    expect(embeddings[0]).toHaveLength(1536);
    expect(embeddings[0]).toEqual(embeddings[1]);
    const norm = Math.sqrt(embeddings[0].reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1);
  });

  it('scores overlapping texts above unrelated ones', async () => {
    const e = new HashEmbedder();
    const { embeddings } = await e.embed([
      'horário do culto de domingo',
      'culto de domingo às 10h',
      'receita de bolo de cenoura',
    ]);
    expect(cosine(embeddings[0], embeddings[1])).toBeGreaterThan(cosine(embeddings[0], embeddings[2]));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ai/embedder.test.ts`
Expected: FAIL — cannot resolve `@/ai/embedder`.

- [ ] **Step 3: Write `src/ai/embedder.ts`**

```ts
import { embedMany } from 'ai';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './pricing';

export type EmbedResult = { embeddings: number[][]; tokens: number };

export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<EmbedResult>;
}

// Production embedder: Vercel AI Gateway resolves the plain model string.
export class GatewayEmbedder implements Embedder {
  readonly model = EMBEDDING_MODEL;

  async embed(texts: string[]): Promise<EmbedResult> {
    const { embeddings, usage } = await embedMany({ model: EMBEDDING_MODEL, values: texts });
    return { embeddings, tokens: usage?.tokens ?? 0 };
  }
}

// Deterministic bag-of-words embedding for tests and offline seeding: word overlap
// produces cosine similarity, so retrieval behaves realistically without an API.
export class HashEmbedder implements Embedder {
  readonly model = 'test/hash-embedder';

  async embed(texts: string[]): Promise<EmbedResult> {
    return { embeddings: texts.map(hashVector), tokens: 0 };
  }
}

function hashVector(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % EMBEDDING_DIMENSIONS] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
```

Note: if `embedMany` rejects a plain model string in the installed `ai` version, the fix is `import { gateway } from 'ai'` and `model: gateway.textEmbeddingModel(EMBEDDING_MODEL)` — check `node_modules/ai/dist/index.d.ts` for the exported gateway helper before inventing anything.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ai/embedder.test.ts`
Expected: 2 passing. Also run `npm run typecheck` (GatewayEmbedder compiles against the installed AI SDK).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ai): embedder interface with gateway impl and deterministic test fake"
```

---

### Task 7: Knowledge retrieval (RAG core)

**Files:**
- Create: `src/core/retrieval.ts`, `tests/core/retrieval.test.ts`

**Interfaces:**
- Consumes: `Db`, `chunks`, `documents`, `Embedder`.
- Produces: `searchKnowledgeBase(db, embedder, churchId, query, opts?): Promise<SearchResult>` from `@/core/retrieval`, with `type Source = { documentId: string; documentTitle: string; excerpt: string; score: number }` and `type SearchResult = { sources: Source[]; embeddingTokens: number }`. `opts = { k?: number; minScore?: number }`.

- [ ] **Step 1: Write the failing tests `tests/core/retrieval.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { chunkMarkdown } from '@/core/chunking';
import { searchKnowledgeBase } from '@/core/retrieval';
import type { Db } from '@/db/client';
import { chunks, documents } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

const embedder = new HashEmbedder();

async function seedDoc(db: Db, churchId: string, title: string, markdown: string) {
  const [doc] = await db.insert(documents).values({ churchId, title, kind: 'faq' }).returning();
  const pieces = chunkMarkdown(markdown);
  const { embeddings } = await embedder.embed(pieces.map((p) => p.content));
  await db.insert(chunks).values(
    pieces.map((p, i) => ({ churchId, documentId: doc.id, seq: p.seq, content: p.content, embedding: embeddings[i] })),
  );
  return doc;
}

describe('searchKnowledgeBase', () => {
  it('ranks the on-topic document first and carries citation fields', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    await seedDoc(db, church.id, 'Horários', '## Culto de domingo\n\nO culto de domingo acontece às 10h e às 18h.');
    await seedDoc(db, church.id, 'Ministérios', '## OTB Jovens\n\nEncontro dos jovens aos sábados às 19h.');
    const { sources } = await searchKnowledgeBase(db, embedder, church.id, 'que horas é o culto de domingo?');
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0].documentTitle).toBe('Horários');
    expect(sources[0].excerpt).toContain('10h');
    expect(sources[0].score).toBeGreaterThan(0);
  });

  it('never returns another tenant’s chunks', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    await seedDoc(db, b.id, 'Segredo de B', '## Culto\n\nCulto secreto da igreja B às 10h de domingo.');
    const { sources } = await searchKnowledgeBase(db, embedder, a.id, 'culto de domingo');
    expect(sources).toHaveLength(0);
  });

  it('filters below minScore and caps at k', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    await seedDoc(db, church.id, 'Horários', '## Culto\n\nCulto de domingo às 10h.');
    const none = await searchKnowledgeBase(db, embedder, church.id, 'xyzzy quux', { minScore: 0.9 });
    expect(none.sources).toHaveLength(0);
    const capped = await searchKnowledgeBase(db, embedder, church.id, 'culto', { k: 1, minScore: 0 });
    expect(capped.sources.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/retrieval.test.ts`
Expected: FAIL — cannot resolve `@/core/retrieval`.

- [ ] **Step 3: Write `src/core/retrieval.ts`**

```ts
import { cosineDistance, desc, eq, sql } from 'drizzle-orm';
import type { Embedder } from '@/ai/embedder';
import type { Db } from '@/db/client';
import { chunks, documents } from '@/db/schema';

export type Source = { documentId: string; documentTitle: string; excerpt: string; score: number };
export type SearchResult = { sources: Source[]; embeddingTokens: number };

export async function searchKnowledgeBase(
  db: Db,
  embedder: Embedder,
  churchId: string,
  query: string,
  opts: { k?: number; minScore?: number } = {},
): Promise<SearchResult> {
  const { k = 5, minScore = 0.15 } = opts;
  const { embeddings, tokens } = await embedder.embed([query]);
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, embeddings[0])})`;

  const rows = await db
    .select({
      documentId: chunks.documentId,
      documentTitle: documents.title,
      excerpt: chunks.content,
      score: similarity,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(eq(chunks.churchId, churchId))
    .orderBy(desc(similarity))
    .limit(k);

  return {
    sources: rows
      .filter((r) => Number(r.score) >= minScore)
      .map((r) => ({ ...r, score: Number(r.score), excerpt: r.excerpt.slice(0, 400) })),
    embeddingTokens: tokens,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/retrieval.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): tenant-scoped pgvector retrieval with citation sources"
```

---

### Task 8: Tenant repositories (churches, chat, events, prayer, tickets)

**Files:**
- Create: `src/db/repo/churches.ts`, `src/db/repo/chat.ts`, `src/db/repo/events.ts`, `src/db/repo/prayer.ts`, `src/db/repo/tickets.ts`, `tests/db/repos.test.ts`

**Interfaces:**
- Consumes: `Db`, schema tables.
- Produces:
  - `@/db/repo/churches`: `DEMO_CHURCH_SLUG = 'demo'`, `getChurchBySlug(db, slug)`.
  - `@/db/repo/chat`: `ensureConversation(db, { id, churchId, visitorKey, channel? })`, `saveMessage(db, { churchId, conversationId, role, parts })`, `listMessages(db, conversationId)` (ordered by `seq`).
  - `@/db/repo/events`: `listUpcomingEvents(db, churchId, limit?, now?)`, `createEvent(db, { churchId, title, startsAt, location?, description? })`.
  - `@/db/repo/prayer`: `createPrayerRequest(db, { churchId, conversationId?, name?, request })`, `listPrayerRequests(db, churchId)`.
  - `@/db/repo/tickets`: `createTicket(db, { churchId, conversationId?, topic })`, `listTickets(db, churchId)`.

- [ ] **Step 1: Write the failing tests `tests/db/repos.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { ensureConversation, listMessages, saveMessage } from '@/db/repo/chat';
import { getChurchBySlug } from '@/db/repo/churches';
import { createEvent, listUpcomingEvents } from '@/db/repo/events';
import { createPrayerRequest, listPrayerRequests } from '@/db/repo/prayer';
import { createTicket, listTickets } from '@/db/repo/tickets';
import { churches } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

describe('repos', () => {
  it('finds a church by slug', async () => {
    const db = await createTestDb();
    await db.insert(churches).values({ slug: 'demo', name: 'Igreja da Colina' });
    expect((await getChurchBySlug(db, 'demo'))?.name).toBe('Igreja da Colina');
    expect(await getChurchBySlug(db, 'nope')).toBeUndefined();
  });

  it('conversation is idempotent; messages come back in order', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const convId = crypto.randomUUID();
    await ensureConversation(db, { id: convId, churchId: church.id, visitorKey: 'v1' });
    await ensureConversation(db, { id: convId, churchId: church.id, visitorKey: 'v1' }); // no throw
    await saveMessage(db, { churchId: church.id, conversationId: convId, role: 'user', parts: [{ type: 'text', text: 'oi' }] });
    await saveMessage(db, { churchId: church.id, conversationId: convId, role: 'assistant', parts: [{ type: 'text', text: 'olá!' }] });
    const msgs = await listMessages(db, convId);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('lists only future events for the tenant, soonest first', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const now = new Date('2026-09-01T00:00:00Z');
    await createEvent(db, { churchId: a.id, title: 'Passado', startsAt: new Date('2026-08-01T10:00:00Z') });
    await createEvent(db, { churchId: a.id, title: 'Culto', startsAt: new Date('2026-09-06T10:00:00Z') });
    await createEvent(db, { churchId: a.id, title: 'Retiro', startsAt: new Date('2026-10-10T08:00:00Z') });
    await createEvent(db, { churchId: b.id, title: 'De outra igreja', startsAt: new Date('2026-09-02T10:00:00Z') });
    const list = await listUpcomingEvents(db, a.id, 10, now);
    expect(list.map((e) => e.title)).toEqual(['Culto', 'Retiro']);
  });

  it('creates and lists prayer requests and tickets per tenant', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    await createPrayerRequest(db, { churchId: church.id, request: 'Pela minha família' });
    expect((await listPrayerRequests(db, church.id))[0].status).toBe('new');
    const ticket = await createTicket(db, { churchId: church.id, topic: 'Falar com o pastor' });
    expect(ticket.status).toBe('open');
    expect(await listTickets(db, church.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/repos.test.ts`
Expected: FAIL — cannot resolve `@/db/repo/churches`.

- [ ] **Step 3: Write the five repo files**

`src/db/repo/churches.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { churches } from '@/db/schema';

export const DEMO_CHURCH_SLUG = 'demo';

export async function getChurchBySlug(db: Db, slug: string) {
  const [row] = await db.select().from(churches).where(eq(churches.slug, slug));
  return row;
}
```

`src/db/repo/chat.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { conversations, messages } from '@/db/schema';

export async function ensureConversation(
  db: Db,
  input: { id: string; churchId: string; visitorKey: string; channel?: string },
): Promise<void> {
  await db
    .insert(conversations)
    .values({ id: input.id, churchId: input.churchId, visitorKey: input.visitorKey, channel: input.channel ?? 'web' })
    .onConflictDoNothing();
}

export async function saveMessage(
  db: Db,
  input: { churchId: string; conversationId: string; role: 'user' | 'assistant'; parts: unknown },
): Promise<void> {
  await db.insert(messages).values(input);
}

export async function listMessages(db: Db, conversationId: string) {
  return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.seq));
}
```

`src/db/repo/events.ts`:

```ts
import { and, asc, eq, gte } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { events } from '@/db/schema';

export async function listUpcomingEvents(db: Db, churchId: string, limit = 10, now = new Date()) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.churchId, churchId), gte(events.startsAt, now)))
    .orderBy(asc(events.startsAt))
    .limit(limit);
}

export async function createEvent(
  db: Db,
  input: { churchId: string; title: string; startsAt: Date; location?: string; description?: string },
) {
  const [row] = await db.insert(events).values(input).returning();
  return row;
}
```

`src/db/repo/prayer.ts`:

```ts
import { desc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { prayerRequests } from '@/db/schema';

export async function createPrayerRequest(
  db: Db,
  input: { churchId: string; conversationId?: string; name?: string; request: string },
) {
  const [row] = await db.insert(prayerRequests).values(input).returning();
  return row;
}

export async function listPrayerRequests(db: Db, churchId: string) {
  return db
    .select()
    .from(prayerRequests)
    .where(eq(prayerRequests.churchId, churchId))
    .orderBy(desc(prayerRequests.createdAt));
}
```

`src/db/repo/tickets.ts`:

```ts
import { desc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { tickets } from '@/db/schema';

export async function createTicket(db: Db, input: { churchId: string; conversationId?: string; topic: string }) {
  const [row] = await db.insert(tickets).values(input).returning();
  return row;
}

export async function listTickets(db: Db, churchId: string) {
  return db.select().from(tickets).where(eq(tickets.churchId, churchId)).orderBy(desc(tickets.createdAt));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db/repos.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): tenant-scoped repositories for churches, chat, events, prayer, tickets"
```

---

### Task 9: Secretary agent (prompt + tools)

**Files:**
- Create: `src/agent/secretary.ts`, `tests/agent/secretary.test.ts`

**Interfaces:**
- Consumes: repos (Task 8), `searchKnowledgeBase` (Task 7), `recordUsage` (Task 3), `CHAT_MODEL`.
- Produces: from `@/agent/secretary`: `type SecretaryDeps = { db: Db; embedder: Embedder; model?: LanguageModel }`, `type SecretaryInput = { churchId: string; churchName: string; conversationId: string; uiMessages: UIMessage[] }`, `secretaryTools(deps, ctx: { churchId: string; conversationId: string })`, `runSecretary(deps, input)` returning the `streamText` result (caller turns it into a UIMessage stream response).

- [ ] **Step 1: Write the failing tests `tests/agent/secretary.test.ts`** (tool behavior is tested directly — deterministic; the full LLM loop is exercised in Task 10)

```ts
import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { secretaryTools } from '@/agent/secretary';
import { chunkMarkdown } from '@/core/chunking';
import { listPrayerRequests } from '@/db/repo/prayer';
import { listTickets } from '@/db/repo/tickets';
import { chunks, documents, events, usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

async function setup() {
  const db = await createTestDb();
  const church = await seedChurch(db, 'Igreja da Colina');
  const conversationId = crypto.randomUUID();
  const { ensureConversation } = await import('@/db/repo/chat');
  await ensureConversation(db, { id: conversationId, churchId: church.id, visitorKey: 'test' });
  const tools = secretaryTools(
    { db, embedder: new HashEmbedder() },
    { churchId: church.id, conversationId },
  );
  return { db, church, conversationId, tools };
}

describe('secretaryTools', () => {
  it('searchKnowledge returns sources and meters the embedding call', async () => {
    const { db, church, tools } = await setup();
    const embedder = new HashEmbedder();
    const [doc] = await db.insert(documents).values({ churchId: church.id, title: 'Horários', kind: 'schedule' }).returning();
    const pieces = chunkMarkdown('## Culto\n\nCulto de domingo às 10h.');
    const { embeddings } = await embedder.embed(pieces.map((p) => p.content));
    await db.insert(chunks).values(pieces.map((p, i) => ({ churchId: church.id, documentId: doc.id, seq: p.seq, content: p.content, embedding: embeddings[i] })));

    const out = await tools.searchKnowledge.execute!({ query: 'culto de domingo' }, {} as never);
    expect(out.sources[0].documentTitle).toBe('Horários');
    const ledger = await db.select().from(usageLedger);
    expect(ledger.some((u) => u.feature === 'chat.retrieval')).toBe(true);
  });

  it('getCalendar lists upcoming events', async () => {
    const { db, church, tools } = await setup();
    await db.insert(events).values({ churchId: church.id, title: 'Retiro', startsAt: new Date(Date.now() + 86_400_000) });
    const out = await tools.getCalendar.execute!({}, {} as never);
    expect(out.events.map((e: { title: string }) => e.title)).toContain('Retiro');
  });

  it('createPrayerRequest persists with the conversation id', async () => {
    const { db, church, conversationId, tools } = await setup();
    const out = await tools.createPrayerRequest.execute!({ request: 'Pela minha avó', name: 'Ana' }, {} as never);
    expect(out.saved).toBe(true);
    const list = await listPrayerRequests(db, church.id);
    expect(list[0].conversationId).toBe(conversationId);
  });

  it('escalateToHuman opens a ticket', async () => {
    const { db, church, tools } = await setup();
    const out = await tools.escalateToHuman.execute!({ topic: 'Agendar aconselhamento' }, {} as never);
    expect(out.ticketId).toBeDefined();
    expect((await listTickets(db, church.id))[0].topic).toBe('Agendar aconselhamento');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agent/secretary.test.ts`
Expected: FAIL — cannot resolve `@/agent/secretary`.

- [ ] **Step 3: Write `src/agent/secretary.ts`**

```ts
import { convertToModelMessages, stepCountIs, streamText, tool } from 'ai';
import type { LanguageModel, UIMessage } from 'ai';
import { z } from 'zod';
import type { Embedder } from '@/ai/embedder';
import { CHAT_MODEL } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import { searchKnowledgeBase } from '@/core/retrieval';
import type { Db } from '@/db/client';
import { listUpcomingEvents } from '@/db/repo/events';
import { createPrayerRequest } from '@/db/repo/prayer';
import { createTicket } from '@/db/repo/tickets';

export type SecretaryDeps = { db: Db; embedder: Embedder; model?: LanguageModel };
export type SecretaryInput = {
  churchId: string;
  churchName: string;
  conversationId: string;
  uiMessages: UIMessage[];
};

function systemPrompt(churchName: string): string {
  return [
    `You are the virtual secretary ("Secretária Virtual") of ${churchName}, a Brazilian church.`,
    'Always reply in the language the visitor writes in. Church content is in Portuguese; translate naturally when needed.',
    'Ground every factual claim about the church (schedules, addresses, events, ministries, contacts) in results from the searchKnowledge or getCalendar tools. If the tools do not support an answer, say you do not know and offer to connect the visitor with a person. Never invent facts.',
    'When a visitor shares a prayer need and wants the church to pray, use createPrayerRequest (ask for their name, but it is optional).',
    'When the visitor asks for a human, or you cannot help after searching, use escalateToHuman.',
    'Keep answers short, warm, and practical. Do not give pastoral counseling, medical, legal, or financial advice — offer escalation instead.',
    'This is a public demo of a fictional church; if asked, be transparent about that.',
  ].join('\n');
}

export function secretaryTools(deps: SecretaryDeps, ctx: { churchId: string; conversationId: string }) {
  return {
    searchKnowledge: tool({
      description: 'Search the church knowledge base (schedules, bulletins, ministries, FAQs). Returns source excerpts to cite.',
      inputSchema: z.object({ query: z.string().describe('Search query in Portuguese') }),
      execute: async ({ query }) => {
        const { sources, embeddingTokens } = await searchKnowledgeBase(deps.db, deps.embedder, ctx.churchId, query);
        await recordUsage(deps.db, {
          churchId: ctx.churchId,
          feature: 'chat.retrieval',
          model: deps.embedder.model,
          inputTokens: embeddingTokens,
          outputTokens: 0,
        });
        return { sources };
      },
    }),
    getCalendar: tool({
      description: 'List the next upcoming church events with dates and locations.',
      inputSchema: z.object({}),
      execute: async () => ({ events: await listUpcomingEvents(deps.db, ctx.churchId, 10) }),
    }),
    createPrayerRequest: tool({
      description: 'Save a prayer request for the church intercession team.',
      inputSchema: z.object({
        request: z.string().describe('The prayer need, in the visitor’s words'),
        name: z.string().optional().describe('Visitor name, if given'),
      }),
      execute: async ({ request, name }) => {
        await createPrayerRequest(deps.db, { churchId: ctx.churchId, conversationId: ctx.conversationId, request, name });
        return { saved: true };
      },
    }),
    escalateToHuman: tool({
      description: 'Open a ticket for the church staff to contact the visitor personally.',
      inputSchema: z.object({ topic: z.string().describe('Short summary of what the visitor needs') }),
      execute: async ({ topic }) => {
        const ticket = await createTicket(deps.db, { churchId: ctx.churchId, conversationId: ctx.conversationId, topic });
        return { ticketId: ticket.id, note: 'Staff will follow up in this conversation.' };
      },
    }),
  };
}

export function runSecretary(deps: SecretaryDeps, input: SecretaryInput) {
  return streamText({
    model: deps.model ?? CHAT_MODEL,
    system: systemPrompt(input.churchName),
    messages: convertToModelMessages(input.uiMessages),
    tools: secretaryTools(deps, { churchId: input.churchId, conversationId: input.conversationId }),
    stopWhen: stepCountIs(5),
    onFinish: async ({ usage }) => {
      await recordUsage(deps.db, {
        churchId: input.churchId,
        feature: 'chat.reply',
        model: CHAT_MODEL,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      });
    },
  });
}
```

Note: `recordUsage` in `onFinish` uses `CHAT_MODEL` for pricing even when a mock model is injected in tests — that is intentional (tests assert the ledger row exists, not its price source).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agent/secretary.test.ts && npm run typecheck`
Expected: 4 passing; typecheck clean. If `tool(...).execute` typing complains about the second argument, check the installed `ai` version's `ToolExecutionOptions` type in `node_modules/ai/dist/index.d.ts` and cast the test invocation accordingly — do not weaken the production types.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(agent): secretary agent with grounded tools and metered usage"
```

---

### Task 10: Web channel handler + chat API route

**Files:**
- Create: `src/core/channel.ts`, `src/channels/web.ts`, `src/app/api/chat/route.ts`, `tests/channels/web.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `handleChatRequest(deps: WebChannelDeps, req: Request): Promise<Response>` from `@/channels/web` with `type WebChannelDeps = SecretaryDeps & { globalCapUsd: number }`; HTTP contract: POST JSON `{ messages: UIMessage[], conversationId: uuid }` → UIMessage stream; `400` bad body, `429` rate limited, `402` budget exhausted. `@/core/channel` documents the channel contract for the future WhatsApp adapter.

- [ ] **Step 1: Write `src/core/channel.ts`** (contract documentation — no logic yet beyond types)

```ts
import type { UIMessage } from 'ai';

// Channel contract: every chat surface converts its transport into this shape and
// hands it to the secretary agent. The web adapter (src/channels/web.ts) streams the
// reply back over HTTP; a future WhatsApp adapter would buffer the full reply and
// call its Graph-API `deliver` instead. Core agent code never imports transport code.
export type IncomingChat = {
  churchId: string;
  conversationId: string;
  visitorKey: string;
  uiMessages: UIMessage[];
};

export interface ChannelAdapter {
  readonly name: 'web' | 'whatsapp';
  readonly supportsStreaming: boolean;
}
```

- [ ] **Step 2: Write the failing tests `tests/channels/web.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { handleChatRequest } from '@/channels/web';
import { budgets, churches } from '@/db/schema';
import { createTestDb } from '../helpers/db';

async function setupDemo() {
  const db = await createTestDb();
  const [church] = await db.insert(churches).values({ slug: 'demo', name: 'Igreja da Colina' }).returning();
  await db.insert(budgets).values({ churchId: church.id, monthlyUsd: 40 });
  return { db, church };
}

function chatReq(body: unknown, ip = '9.9.9.9'): Request {
  return new Request('http://test/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

const userMessages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Olá!' }] }];

describe('handleChatRequest', () => {
  it('rejects a malformed body with 400', async () => {
    const { db } = await setupDemo();
    const res = await handleChatRequest({ db, embedder: new HashEmbedder(), globalCapUsd: 50 }, chatReq({ nope: true }));
    expect(res.status).toBe(400);
  });

  it('returns 429 after the per-visitor limit', async () => {
    const { db } = await setupDemo();
    const deps = { db, embedder: new HashEmbedder(), globalCapUsd: 50 };
    // Drain the limit (20/10min) without invoking the model: malformed bodies do not
    // count, so send valid-shaped requests against an exhausted budget instead —
    // budget check happens after rate limiting, so use a 0-cap to short-circuit.
    const zeroCap = { ...deps, globalCapUsd: 0 };
    let last: Response | null = null;
    for (let i = 0; i < 21; i++) {
      last = await handleChatRequest(zeroCap, chatReq({ messages: userMessages, conversationId: crypto.randomUUID() }));
    }
    expect(last!.status).toBe(429);
  });

  it('returns 402 when the global budget is exhausted', async () => {
    const { db } = await setupDemo();
    const res = await handleChatRequest(
      { db, embedder: new HashEmbedder(), globalCapUsd: 0 },
      chatReq({ messages: userMessages, conversationId: crypto.randomUUID() }),
    );
    expect(res.status).toBe(402);
  });

  it('streams a reply and persists both sides of the exchange', async () => {
    const { db, church } = await setupDemo();
    const { MockLanguageModelV3 } = await import('ai/test');
    const { simulateReadableStream } = await import('ai');
    // Stream part shapes follow the installed AI SDK's LanguageModelV3StreamPart —
    // if this fixture fails to compile, mirror the shapes from node_modules/ai/test/dist/index.d.ts.
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 't1' },
            { type: 'text-delta', id: 't1', delta: 'Olá! Como posso ajudar?' },
            { type: 'text-end', id: 't1' },
            { type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 } },
          ],
        }),
      }),
    });
    const conversationId = crypto.randomUUID();
    const res = await handleChatRequest(
      { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 },
      chatReq({ messages: userMessages, conversationId }),
    );
    expect(res.status).toBe(200);
    await res.text(); // drain the stream so onFinish runs
    const { listMessages } = await import('@/db/repo/chat');
    const saved = await listMessages(db, conversationId);
    expect(saved.map((m) => m.role)).toEqual(['user', 'assistant']);
    const { usageLedger } = await import('@/db/schema');
    const ledger = await db.select().from(usageLedger);
    expect(ledger.some((u) => u.feature === 'chat.reply')).toBe(true);
    expect(saved.every((m) => m.churchId === church.id)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/channels/web.test.ts`
Expected: FAIL — cannot resolve `@/channels/web`.

- [ ] **Step 4: Write `src/channels/web.ts`**

```ts
import type { UIMessage } from 'ai';
import { z } from 'zod';
import { checkBudget } from '@/ai/usage';
import { runSecretary, type SecretaryDeps } from '@/agent/secretary';
import { checkRateLimit } from '@/core/rate-limit';
import { ensureConversation, saveMessage } from '@/db/repo/chat';
import { DEMO_CHURCH_SLUG, getChurchBySlug } from '@/db/repo/churches';

export type WebChannelDeps = SecretaryDeps & { globalCapUsd: number };

const bodySchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).min(1),
  conversationId: z.uuid(),
});

const CHAT_LIMIT = { limit: 20, windowSeconds: 600 };

export async function handleChatRequest(deps: WebChannelDeps, req: Request): Promise<Response> {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ code: 'bad_request' }, { status: 400 });
  }

  const church = await getChurchBySlug(deps.db, DEMO_CHURCH_SLUG);
  if (!church) return Response.json({ code: 'not_seeded' }, { status: 500 });

  const visitorKey = (req.headers.get('x-forwarded-for') ?? 'anon').split(',')[0].trim();
  const rate = await checkRateLimit(deps.db, `chat:${visitorKey}`, CHAT_LIMIT);
  if (!rate.allowed) return Response.json({ code: 'rate_limited' }, { status: 429 });

  const budget = await checkBudget(deps.db, church.id, deps.globalCapUsd);
  if (!budget.allowed) return Response.json({ code: 'budget_exhausted', reason: budget.reason }, { status: 402 });

  await ensureConversation(deps.db, { id: body.conversationId, churchId: church.id, visitorKey });

  const uiMessages = body.messages as unknown as UIMessage[];
  const last = uiMessages[uiMessages.length - 1];
  if (last?.role === 'user') {
    await saveMessage(deps.db, { churchId: church.id, conversationId: body.conversationId, role: 'user', parts: last.parts });
  }

  const result = runSecretary(deps, {
    churchId: church.id,
    churchName: church.name,
    conversationId: body.conversationId,
    uiMessages,
  });

  return result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage }) => {
      await saveMessage(deps.db, {
        churchId: church.id,
        conversationId: body.conversationId,
        role: 'assistant',
        parts: responseMessage.parts,
      });
    },
  });
}
```

- [ ] **Step 5: Write `src/app/api/chat/route.ts`**

```ts
import { GatewayEmbedder } from '@/ai/embedder';
import { handleChatRequest } from '@/channels/web';
import { getDb } from '@/db/client';

export const maxDuration = 60;

export async function POST(req: Request) {
  return handleChatRequest(
    {
      db: getDb(),
      embedder: new GatewayEmbedder(),
      globalCapUsd: Number(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP ?? '50'),
    },
    req,
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/channels/web.test.ts && npm run typecheck`
Expected: 4 passing; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(channels): web chat handler with rate limit, budget gate, and persistence"
```

---

### Task 11: Seed corpus + seed script

**Files:**
- Create: `content/seed/horarios-e-contato.md`, `content/seed/boletim-outubro-2026.md`, `content/seed/ministerios.md`, `content/seed/events.json`, `scripts/seed.ts`, `tests/scripts/seed-corpus.test.ts`

**Interfaces:**
- Consumes: chunker, embedder, schema, repos.
- Produces: `npm run seed` populates the demo church (slug `demo`, name `Igreja da Colina`, budget $40/mo), all seed documents chunked + embedded, and calendar events. `SEED_FAKE_EMBEDDER=1 npm run seed` uses `HashEmbedder` (no API key needed). Re-running is safe (wipes and re-seeds the demo tenant only).

- [ ] **Step 1: Create `content/seed/horarios-e-contato.md`**

```markdown
# Horários e Contato — Igreja da Colina

> Igreja fictícia, criada para demonstração. Nenhuma informação aqui é real.

## Cultos e reuniões

- **Culto de Celebração**: domingos às 10h e às 18h30.
- **Culto de Oração**: quartas-feiras às 20h.
- **Escola Bíblica**: domingos às 9h, salas por faixa etária.
- **Santa Ceia**: primeiro domingo do mês, nos dois cultos.

## Endereço

Rua das Palmeiras, 123 — Jardim Esperança, São Paulo/SP, CEP 04000-000 (endereço fictício).
Estacionamento gratuito no local, com vagas acessíveis. A entrada principal tem rampa.

## Contato

- Telefone e WhatsApp da secretaria: (11) 90000-0000 (fictício)
- E-mail: contato@igrejadacolina.example
- Horário da secretaria: terça a sexta, das 9h às 17h.

## Ofertas e dízimos

Contribuições podem ser entregues nos gazofilácios durante os cultos ou por PIX na chave
fictícia pix@igrejadacolina.example. A igreja publica relatório financeiro trimestral aos
membros.

## Perguntas frequentes

- **Preciso me inscrever para visitar?** Não, chegue alguns minutos antes e será bem-vindo.
- **Há atividades para crianças?** Sim, o Ministério Infantil funciona durante os cultos de
  domingo para crianças de 2 a 10 anos.
- **Como me tornar membro?** Participe da Classe de Integração, oferecida a cada dois meses;
  fale com a secretaria para a próxima turma.
```

- [ ] **Step 2: Create `content/seed/boletim-outubro-2026.md`**

```markdown
# Boletim Informativo — Outubro de 2026

> Igreja da Colina — igreja fictícia, criada para demonstração.

## Agenda do mês

- **04/10 (domingo), 10h e 18h30** — Culto com Santa Ceia.
- **10/10 (sábado), 19h** — Encontro de jovens OTB, quadra coberta. Tema: "Fé e vocação".
- **17/10 (sábado), 8h às 12h** — Ação social: mutirão de doação de alimentos no salão
  comunitário. Traga alimentos não perecíveis.
- **24/10 (sábado), 9h** — Café das mulheres, com convidada especial. Inscrições com a
  secretaria até 20/10.
- **31/10 (sábado), 19h30** — Noite de louvor com o coral e a banda da igreja.

## Avisos

A Classe de Integração de novembro já está com inscrições abertas na secretaria. O
relatório financeiro do terceiro trimestre estará disponível aos membros a partir de
15/10. O Ministério Infantil precisa de voluntários para o berçário — fale com a
coordenação após os cultos.

## Palavra pastoral

Neste mês, meditamos em Filipenses 4. Que a gratidão seja o tom das nossas orações, e que
a paz de Deus guarde os nossos corações em Cristo Jesus.
```

- [ ] **Step 3: Create `content/seed/ministerios.md`**

```markdown
# Ministérios — Igreja da Colina

> Igreja fictícia, criada para demonstração.

## OTB Jovens

Grupo de adolescentes e jovens (13 a 29 anos). Encontros aos sábados às 19h na quadra
coberta, com louvor, palavra e esportes. Liderança: casal fictício Marcos e Júlia.

## GD Adultos

Grupos de discipulado que se reúnem nas casas durante a semana, em vários bairros.
Para encontrar um grupo perto de você, fale com a secretaria informando seu bairro.

## Ministério Infantil

Atende crianças de 2 a 10 anos durante os cultos de domingo, com equipe treinada e
check-in identificado dos responsáveis. Berçário disponível no culto das 10h.

## Ministério de Louvor

Coral e banda. Ensaios às quintas-feiras às 20h. Novos músicos e vozes passam por uma
conversa com a liderança e um período de acompanhamento.

## Ação Social

Distribuição mensal de cestas básicas e mutirões trimestrais no salão comunitário.
Doações de alimentos não perecíveis podem ser entregues na secretaria.
```

- [ ] **Step 4: Create `content/seed/events.json`**

```json
[
  { "title": "Culto com Santa Ceia", "startsAt": "2026-10-04T13:00:00Z", "location": "Templo principal", "description": "Cultos das 10h e 18h30 com Santa Ceia." },
  { "title": "Encontro de jovens OTB", "startsAt": "2026-10-10T22:00:00Z", "location": "Quadra coberta", "description": "Tema: Fé e vocação." },
  { "title": "Mutirão de doação de alimentos", "startsAt": "2026-10-17T11:00:00Z", "location": "Salão comunitário", "description": "Ação social — traga alimentos não perecíveis." },
  { "title": "Café das mulheres", "startsAt": "2026-10-24T12:00:00Z", "location": "Salão comunitário", "description": "Inscrições com a secretaria até 20/10." },
  { "title": "Noite de louvor", "startsAt": "2026-10-31T22:30:00Z", "location": "Templo principal", "description": "Com o coral e a banda da igreja." },
  { "title": "Classe de Integração", "startsAt": "2026-11-08T12:00:00Z", "location": "Sala 3", "description": "Turma de novembro para novos membros." }
]
```

- [ ] **Step 5: Write `scripts/seed.ts`**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { eq, inArray } from 'drizzle-orm';
import { GatewayEmbedder, HashEmbedder, type Embedder } from '@/ai/embedder';
import { recordUsage } from '@/ai/usage';
import { chunkMarkdown } from '@/core/chunking';
import { getDb } from '@/db/client';
import { DEMO_CHURCH_SLUG } from '@/db/repo/churches';
import { budgets, chunks, churches, conversations, documents, events, messages, prayerRequests, tickets, usageLedger } from '@/db/schema';

config({ path: '.env.local' });

const SEED_DIR = path.join(process.cwd(), 'content', 'seed');
const DOC_KINDS: Record<string, string> = {
  'horarios-e-contato.md': 'schedule',
  'ministerios.md': 'ministry',
};

async function main() {
  const db = getDb();
  const embedder: Embedder = process.env.SEED_FAKE_EMBEDDER ? new HashEmbedder() : new GatewayEmbedder();
  console.log(`Seeding with ${embedder.model}`);

  // Wipe the demo tenant only, children first (idempotent re-seed).
  const [existing] = await db.select().from(churches).where(eq(churches.slug, DEMO_CHURCH_SLUG));
  if (existing) {
    const docIds = (await db.select({ id: documents.id }).from(documents).where(eq(documents.churchId, existing.id))).map((d) => d.id);
    if (docIds.length) await db.delete(chunks).where(inArray(chunks.documentId, docIds));
    for (const table of [events, messages, prayerRequests, tickets, usageLedger, conversations, documents, budgets]) {
      await db.delete(table).where(eq(table.churchId, existing.id));
    }
    await db.delete(churches).where(eq(churches.id, existing.id));
  }

  const [church] = await db.insert(churches).values({ slug: DEMO_CHURCH_SLUG, name: 'Igreja da Colina' }).returning();
  await db.insert(budgets).values({ churchId: church.id, monthlyUsd: 40 });

  for (const file of readdirSync(SEED_DIR).filter((f) => f.endsWith('.md'))) {
    const markdown = readFileSync(path.join(SEED_DIR, file), 'utf8');
    const title = markdown.split('\n')[0].replace(/^#\s*/, '');
    const kind = DOC_KINDS[file] ?? 'bulletin';
    const [doc] = await db.insert(documents).values({ churchId: church.id, title, kind, sourcePath: `content/seed/${file}` }).returning();
    const pieces = chunkMarkdown(markdown);
    const { embeddings, tokens } = await embedder.embed(pieces.map((p) => p.content));
    await db.insert(chunks).values(
      pieces.map((p, i) => ({ churchId: church.id, documentId: doc.id, seq: p.seq, content: p.content, embedding: embeddings[i] })),
    );
    if (tokens > 0) {
      await recordUsage(db, { churchId: church.id, feature: 'ingest.embed', model: embedder.model, inputTokens: tokens, outputTokens: 0 });
    }
    console.log(`  ${file}: ${pieces.length} chunks`);
  }

  const seedEvents = JSON.parse(readFileSync(path.join(SEED_DIR, 'events.json'), 'utf8')) as
    { title: string; startsAt: string; location?: string; description?: string }[];
  await db.insert(events).values(
    seedEvents.map((e) => ({ churchId: church.id, title: e.title, startsAt: new Date(e.startsAt), location: e.location, description: e.description, verified: true })),
  );
  console.log(`  events.json: ${seedEvents.length} events`);
  console.log('Seed complete.');
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
```

Note: `tsx` does not resolve the `@/*` alias by default — if imports fail, run seeds with `npx tsx --tsconfig tsconfig.json scripts/seed.ts`; if the installed tsx version still doesn't honor `paths`, change the script's imports to relative paths (`../src/...`). Keep `package.json`'s `seed` script matching whatever works.

- [ ] **Step 6: Write the failing test `tests/scripts/seed-corpus.test.ts`** (validates corpus files, not the network)

```ts
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '@/core/chunking';

const SEED_DIR = path.join(process.cwd(), 'content', 'seed');

describe('seed corpus', () => {
  it('has the three markdown documents and events.json', () => {
    const files = readdirSync(SEED_DIR).sort();
    expect(files).toEqual(['boletim-outubro-2026.md', 'events.json', 'horarios-e-contato.md', 'ministerios.md']);
  });

  it('every markdown doc chunks into non-empty pieces and carries the fictional disclaimer', () => {
    for (const file of readdirSync(SEED_DIR).filter((f) => f.endsWith('.md'))) {
      const text = readFileSync(path.join(SEED_DIR, file), 'utf8');
      expect(text).toMatch(/fictíci/i);
      const pieces = chunkMarkdown(text);
      expect(pieces.length).toBeGreaterThan(0);
    }
  });

  it('events.json parses with valid dates', () => {
    const eventsRaw = JSON.parse(readFileSync(path.join(SEED_DIR, 'events.json'), 'utf8')) as { startsAt: string; title: string }[];
    expect(eventsRaw.length).toBeGreaterThanOrEqual(5);
    for (const e of eventsRaw) expect(Number.isNaN(new Date(e.startsAt).getTime())).toBe(false);
  });
});
```

- [ ] **Step 7: Run the tests, then seed the dev database offline**

Run: `npx vitest run tests/scripts/seed-corpus.test.ts`
Expected: 3 passing.

Run: `SEED_FAKE_EMBEDDER=1 npm run seed`
Expected: prints chunk counts per file, `6 events`, `Seed complete.` (uses the dev Neon `DATABASE_URL` from `.env.local`).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(seed): fictional demo church corpus and idempotent seed script"
```

---

### Task 12: Chat UI + root page

**Files:**
- Create: `src/app/chat/page.tsx`, `src/app/chat/chat.tsx`
- Modify: `src/app/page.tsx` (replace scaffold home), `src/app/layout.tsx` (title/description only)

**Interfaces:**
- Consumes: the `/api/chat` HTTP contract from Task 10 (statuses 400/429/402, UIMessage stream; tool part type `tool-searchKnowledge` with `output.sources: Source[]`).
- Produces: `/chat` — working chat page; `/` — minimal placeholder linking to `/chat` (full landing page is Plan 4).

- [ ] **Step 1: Write `src/app/chat/chat.tsx`** (client component)

```tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useMemo, useState } from 'react';

type SourceOut = { documentTitle: string; excerpt: string };

function SourceChips({ sources }: { sources: SourceOut[] }) {
  if (!sources.length) return null;
  const titles = [...new Set(sources.map((s) => s.documentTitle))];
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {titles.map((t) => (
        <span key={t} title={sources.find((s) => s.documentTitle === t)?.excerpt} className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
          📄 {t}
        </span>
      ))}
    </div>
  );
}

export default function Chat() {
  const conversationId = useMemo(() => crypto.randomUUID(), []);
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { conversationId } }),
    [conversationId],
  );
  const { messages, sendMessage, status, error } = useChat({ transport });
  const [input, setInput] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status !== 'ready') return;
    sendMessage({ text: input });
    setInput('');
  };

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col p-4">
      <header className="border-b pb-3">
        <h1 className="text-lg font-semibold">Secretária Virtual — Igreja da Colina</h1>
        <p className="text-xs text-neutral-500">
          Igreja fictícia — demonstração · Fictional church — demo. Write in any language.
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="text-sm text-neutral-500">
            Pergunte sobre horários de culto, eventos, ministérios — ou peça oração. 🙏
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={`inline-block max-w-[85%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-900'}`}>
              {m.parts.map((part, i) => {
                if (part.type === 'text') return <span key={i}>{part.text}</span>;
                if (part.type === 'tool-searchKnowledge' && part.state === 'output-available') {
                  const out = part.output as { sources: SourceOut[] };
                  return <SourceChips key={i} sources={out.sources} />;
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {status === 'submitted' && <p className="text-sm text-neutral-400">…</p>}
        {error && (
          <p className="text-sm text-amber-700">
            O demo está temporariamente indisponível (limite de uso atingido). Tente mais tarde. ·
            The demo hit its usage limit — please try again later.
          </p>
        )}
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t pt-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua mensagem…"
          className="flex-1 rounded-xl border px-4 py-2 text-sm outline-none focus:border-neutral-400"
        />
        <button type="submit" disabled={status !== 'ready'} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Enviar
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/chat/page.tsx`**

```tsx
import Chat from './chat';

export const metadata = { title: 'Secretária Virtual — Igreja da Colina (demo)' };

export default function ChatPage() {
  return <Chat />;
}
```

- [ ] **Step 3: Replace `src/app/page.tsx`** (placeholder until Plan 4's landing page)

```tsx
import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex h-dvh max-w-xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">ChurchChatBox V2</h1>
      <p className="text-sm text-neutral-600">
        An AI church secretary — RAG, agents, and automation in one product. Demo of a
        fictional Brazilian church.
      </p>
      <Link href="/chat" className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white">
        Talk to the secretary →
      </Link>
    </main>
  );
}
```

In `src/app/layout.tsx`, set only the metadata:

```tsx
export const metadata: Metadata = {
  title: 'ChurchChatBox V2',
  description: 'AI church secretary — a portfolio project (fictional demo church).',
};
```

- [ ] **Step 4: Verify in the browser** (uses the seeded dev Neon DB; the chat model needs `AI_GATEWAY_API_KEY` in `.env.local` — if it is not set yet, verify the page renders, send one message, and confirm a clean error state; full reply verification then happens in Task 13)

Start the dev server via the preview tools (launch.json entry `dev` → `npm run dev`, port 3000), open `/chat`, send "Que horas é o culto de domingo?", confirm: streamed reply citing Horários (or the clean error state without a key), no console errors. Take a screenshot for Rafael.

- [ ] **Step 5: Typecheck, build, commit**

```bash
npm run typecheck && npm run build
git add -A && git commit -m "feat(ui): streaming chat with source citations and fictional-demo disclaimer"
```

---

### Task 13: Deploy to Vercel + production verification

**Files:**
- Create: `.claude/launch.json` (if Task 12 didn't), `vercel.json` (only if needed)
- Modify: `brain/status.md`, `brain/log/decisions.md`

**Interfaces:**
- Consumes: everything.
- Produces: the live demo URL; production Neon migrated + seeded with real embeddings; env vars set; spec success criterion 1 verified live.

- [ ] **Step 1: Link and configure the Vercel project**

```bash
cd ~/Desktop/Tech/ChurchChatBoxV2
vercel link --yes --project churchchatboxv2
vercel env add DATABASE_URL production
vercel env add AI_GATEWAY_API_KEY production
vercel env add DEMO_GLOBAL_MONTHLY_USD_CAP production
```

`DATABASE_URL` = the Neon **production** branch pooled connection string (create a `production` branch in the Neon project if only the default exists; keep dev on the default branch). `AI_GATEWAY_API_KEY` comes from the Vercel dashboard → AI Gateway. If `vercel` is unauthenticated, STOP and report to Rafael.

- [ ] **Step 2: Migrate and seed production with real embeddings**

```bash
DATABASE_URL="<neon-production-url>" npm run db:migrate
DATABASE_URL="<neon-production-url>" AI_GATEWAY_API_KEY="<key>" npm run seed
```

Expected: seed prints chunk counts and records `ingest.embed` usage (real tokens this time). Never paste the actual values into any committed file.

- [ ] **Step 3: Deploy**

```bash
vercel deploy --prod
```

Expected: a production URL.

- [ ] **Step 4: Verify live (spec success criterion 1)**

Open the production URL in the browser tools: `/chat`, ask "Que horas é o culto de domingo?" → streamed answer citing Horários (10h / 18h30). Ask in English "When are Sunday services?" → English answer, same facts. Ask "vocês têm algum evento em outubro?" → answer grounded in calendar/bulletin. Screenshot for Rafael. Check `usage_ledger` rows appeared:

```bash
DATABASE_URL="<neon-production-url>" npx tsx --tsconfig tsconfig.json -e "import('./src/db/client').then(async ({getDb})=>{const {usageLedger}=await import('./src/db/schema');console.log(await getDb().select().from(usageLedger));process.exit(0)})"
```

- [ ] **Step 5: Update the brain and commit**

Update `brain/status.md` (live URL, Plan 1 complete, next: Plan 2) and append to `brain/log/decisions.md` (embedding model + pricing assumptions confirmed at deploy). Then:

```bash
git add -A && git commit -m "chore(deploy): production deploy, migrated and seeded Neon, brain updated"
git push
```

---

## Self-Review Notes

- **Spec coverage (Plan 1 scope):** chat surface §2.1 (Tasks 9–12), RAG+citations (7, 9, 12), agents/tools (9), tenancy §4.4 (2, 7, 8 — cross-tenant test in Task 7), metering+budgets §5/§6 (3, 10), rate limits §6 (4, 10), channel-agnostic core §4.2 (10), bilingual §7 (9 prompt, 12 UI), seed §8 (11), deploy+criterion 1 §12 (13). Dashboard, ingest pipeline, reports, tickets UI = Plans 2–4 (tables already created here so migrations stay linear).
- **Known API-surface risks** (flagged inline where they bite): AI SDK v6 mock stream part shapes (Task 10), gateway embedding model strings (Task 6), tsx path-alias resolution (Task 11). Each has a concrete fallback instruction referencing installed type definitions — consult them, don't guess.
