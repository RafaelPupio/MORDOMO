# Plan 4: Weekly Reporting + Portfolio Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every week the system reads what actually happened — what visitors asked, what it could not answer, what people asked prayer for, what it cost — and writes the church a short digest in Portuguese. And a stranger landing on the site can understand, in a minute, what this project is and how it works.

**Architecture:** The second genuine multi-agent pipeline, and the second place a second pass earns its keep: an **analyst agent** reads the week's raw activity and produces structured findings (top questions, unanswered questions, prayer themes, counts); a **writer agent** turns those findings into prose a church secretary would actually read. Splitting them keeps the analysis honest — the analyst never has to write nicely, and the writer never has to decide what is true. It runs on a Vercel Cron schedule and is idempotent per (church, week).

**Tech Stack:** Existing. New: a `vercel.json` cron entry and a cron-authenticated route.

This is **Plan 4 of 4**, the last. Plans 1–3 are merged. Spec: `docs/superpowers/specs/2026-08-18-churchchatbox-v2-design.md`.

## Global Constraints

- Every table carries `church_id`; every query tenant-scoped. No exceptions.
- Every LLM/embedding call recorded in `usage_ledger`; background work uses `FAST_MODEL` — except the writer, which may use `CHAT_MODEL` if prose quality justifies it (decide and record why).
- A ledger-write failure must never destroy work that already succeeded.
- Node runtime only — never `runtime = 'edge'`.
- Public repo: no secrets, `.env.example` values empty, fictional data only.
- Staff/report content Portuguese; landing page, code, comments English.
- Cost: a weekly report is one analyst call + one writer call per church. Bound their inputs — the analyst reads a week of activity, which is unbounded by nature.

---

### Task 1: Reports schema and repository

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/repo/reports.ts`, `tests/db/reports.test.ts`, migration (generated)

**Interfaces:**
- `reports` table: `id` (uuid pk), `churchId` (fk, notNull), `periodStart` (timestamp, notNull), `periodEnd` (timestamp, notNull), `findings` (jsonb, notNull), `body` (text, notNull), `createdAt`. Unique on `(churchId, periodStart)` so a re-run replaces rather than duplicates.
- `@/db/repo/reports`: `upsertReport(db, { churchId, periodStart, periodEnd, findings, body })`, `listReports(db, churchId, limit?)`, `getReport(db, churchId, id)`, `getReportForPeriod(db, churchId, periodStart)`.

- [ ] **Step 1: Write the failing test `tests/db/reports.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { getReport, getReportForPeriod, listReports, upsertReport } from '@/db/repo/reports';
import { createTestDb, seedChurch } from '../helpers/db';

const start = new Date('2026-08-10T00:00:00Z');
const end = new Date('2026-08-17T00:00:00Z');

describe('reports repo', () => {
  it('creates a report and reads it back', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const row = await upsertReport(db, {
      churchId: church.id, periodStart: start, periodEnd: end,
      findings: { topQuestions: ['horário do culto'] }, body: 'Resumo da semana.',
    });
    expect((await getReport(db, church.id, row.id))?.body).toBe('Resumo da semana.');
    expect(await listReports(db, church.id)).toHaveLength(1);
  });

  it('re-running the same week replaces rather than duplicates', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    await upsertReport(db, { churchId: church.id, periodStart: start, periodEnd: end, findings: {}, body: 'Primeira versão.' });
    await upsertReport(db, { churchId: church.id, periodStart: start, periodEnd: end, findings: {}, body: 'Segunda versão.' });
    const all = await listReports(db, church.id);
    expect(all).toHaveLength(1);
    expect(all[0].body).toBe('Segunda versão.');
  });

  it('never returns another church’s report', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const row = await upsertReport(db, { churchId: b.id, periodStart: start, periodEnd: end, findings: {}, body: 'De B.' });
    expect(await getReport(db, a.id, row.id)).toBeUndefined();
    expect(await listReports(db, a.id)).toHaveLength(0);
    expect(await getReportForPeriod(db, a.id, start)).toBeUndefined();
  });

  it('finds an existing report for a period', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    expect(await getReportForPeriod(db, church.id, start)).toBeUndefined();
    await upsertReport(db, { churchId: church.id, periodStart: start, periodEnd: end, findings: {}, body: 'x' });
    expect(await getReportForPeriod(db, church.id, start)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.** `npx vitest run tests/db/reports.test.ts`

- [ ] **Step 3: Add the table to `src/db/schema.ts`**

```ts
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  churchId: uuid('church_id').notNull().references(() => churches.id),
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  findings: jsonb('findings').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [unique('reports_church_period_key').on(t.churchId, t.periodStart)]);
```

Import `unique` from `drizzle-orm/pg-core` if it is not already imported.

- [ ] **Step 4: Write `src/db/repo/reports.ts`** with the four functions, every one filtered by `churchId` in SQL. `upsertReport` uses `onConflictDoUpdate` on the unique constraint so a re-run replaces `findings`, `body`, and `periodEnd`.

- [ ] **Step 5: Generate the migration**

```bash
npm run db:generate
```

Read the generated SQL: it must CREATE the new table and its unique constraint and touch nothing else. Do NOT run `db:migrate` — no database is provisioned; PGlite applies migrations during tests.

- [ ] **Step 6: Run tests, full suite, typecheck, lint**

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(reports): reports table and tenant-scoped repository"
```

---

### Task 2: Week activity gathering (deterministic, bounded)

**Files:**
- Create: `src/core/week-activity.ts`, `tests/core/week-activity.test.ts`

**Interfaces:**
- `@/core/week-activity`: `type WeekActivity = { periodStart: Date; periodEnd: Date; visitorQuestions: string[]; prayerRequests: string[]; ticketTopics: string[]; counts: { conversations: number; visitorMessages: number; prayerRequests: number; tickets: number }; costUsd: number }`, and `gatherWeekActivity(db, churchId, periodStart, periodEnd): Promise<WeekActivity>`.
- Bounded: at most `MAX_ITEMS_PER_KIND` (100) items of each kind, each truncated to `MAX_ITEM_CHARS` (400), newest first. This is what keeps the analyst's prompt bounded — the week itself is not.

- [ ] **Step 1: Write the failing test `tests/core/week-activity.test.ts`**

Cover, with real PGlite data:
- only messages with `role: 'user'` become `visitorQuestions` (assistant turns are excluded)
- only rows inside `[periodStart, periodEnd)` are included — seed one row just before the start and one exactly at the end and assert both are excluded
- another church's rows never appear
- counts match what was seeded
- `costUsd` sums only that church's `usage_ledger` rows inside the window
- more than `MAX_ITEMS_PER_KIND` rows are capped, and a very long message is truncated to `MAX_ITEM_CHARS`
- text is extracted from the AI-SDK `parts` jsonb shape (a message whose parts contain a `text` part yields that text; a message with only a tool part yields nothing rather than `[object Object]`)

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement `src/core/week-activity.ts`**

Query `messages`, `prayerRequests`, `tickets`, and `usageLedger`, each scoped by `churchId` and the window, ordered newest-first, with SQL-side `LIMIT`. Extract message text by walking the `parts` array for `{ type: 'text', text }` entries and joining them; skip messages with no text. Truncate and cap in code, and document why the bounds exist.

- [ ] **Step 4: Run tests, full suite, typecheck, lint. Commit**

```bash
git add -A && git commit -m "feat(reports): bounded gathering of a week's activity"
```

---

### Task 3: Analyst agent

**Files:**
- Create: `src/agent/analyst.ts`, `tests/agent/analyst.test.ts`

**Interfaces:**
- `@/agent/analyst`: `type WeekFindings = { topQuestions: { question: string; count: number }[]; unansweredQuestions: string[]; prayerThemes: { theme: string; count: number }[]; notableTickets: string[]; summaryStat: string }`, `analyzeWeek(deps, input): Promise<WeekFindings | null>` where `deps = { db: Db; model?: LanguageModel }` and `input = { churchId: string; activity: WeekActivity }`.
- Meters `report.analyze`. Returns `null` — never throws — when the model call fails, so the caller can decide not to publish a report rather than publishing a fabricated one.

- [ ] **Step 1: Write the failing test `tests/agent/analyst.test.ts`**

Mirror the mock-model shape used in `tests/agent/extractor.test.ts` (the `usage` object needs `cacheRead`/`cacheWrite`/`reasoning` keys for `tsc`). Cover:
- a normal week produces the parsed findings and one `report.analyze` ledger row
- a model failure returns `null`, logs, and does NOT throw
- a week with no activity at all still returns findings (empty arrays) rather than `null` — "nothing happened" is a valid finding, and the agent should not be called at all in that case; assert the no-activity path makes zero model calls
- a ledger-write failure does not discard successful findings

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement `src/agent/analyst.ts`** using `generateObject` with a Zod schema for `WeekFindings`.

The system prompt must instruct it to: work ONLY from the supplied activity and never invent a question nobody asked; identify questions the assistant could not answer (visitors who escalated, or whose question recurs); group prayer requests into themes without quoting anyone's personal details verbatim; and return empty arrays rather than padding. Note in a comment that the analyst's output is consumed by a writer agent, not shown directly.

**Privacy note to encode in the prompt and honour in the schema:** prayer themes are aggregate themes, not quotes. A church digest that repeats "Maria's husband has cancer" back to the office is a privacy failure even though the data is the church's own.

- [ ] **Step 4: Run tests, full suite, typecheck, lint. Commit**

```bash
git add -A && git commit -m "feat(reports): analyst agent that summarises a week from real activity only"
```

---

### Task 4: Writer agent and report generation

**Files:**
- Create: `src/agent/report-writer.ts`, `src/core/weekly-report.ts`, `tests/agent/report-writer.test.ts`, `tests/core/weekly-report.test.ts`

**Interfaces:**
- `@/agent/report-writer`: `writeReport(deps, input): Promise<string>` where `input = { churchName: string; findings: WeekFindings; activity: WeekActivity }`. Returns Portuguese markdown. Meters `report.write`. Returns `''` on failure rather than throwing.
- `@/core/weekly-report`: `type WeeklyReportResult = { status: 'published' | 'skipped-no-activity' | 'failed'; reportId?: string; reason?: string }`, `generateWeeklyReport(deps, input): Promise<WeeklyReportResult>` where `input = { churchId: string; churchName: string; periodStart: Date; periodEnd: Date }`.
- `weekStart(now, weeksAgo?)` helper exported from `@/core/weekly-report` computing the UTC Monday boundary, so the cron and any manual run agree on what "last week" means.

- [ ] **Step 1: Write the failing tests**

`report-writer.test.ts`: produces prose from findings and meters `report.write`; a model failure returns `''` and logs; the prompt receives the findings (capture with a mock model and assert a distinctive finding string appears in the prompt).

`weekly-report.test.ts` — the orchestration, and the important cases:
- a week with activity: analyst → writer → a report row exists with both `findings` and `body`; status `published`
- a week with NO activity: status `skipped-no-activity`, no report row, and **zero model calls** (assert with a mock that throws if called)
- the analyst failing: status `failed`, no report row — a report is never published from fabricated findings
- the writer failing after a successful analysis: status `failed`, and no report row with an empty body
- re-running the same week replaces the previous report rather than duplicating it
- cross-tenant: generating for church A never reads church B's activity

- [ ] **Step 2: Run them, confirm they fail.**

- [ ] **Step 3: Implement both.**

For the writer's model: decide between `FAST_MODEL` and `CHAT_MODEL` and record the reasoning in a comment — this is the one place in the product where prose quality is the deliverable, and it runs once a week per church, so the cost argument differs from the hot chat path.

`generateWeeklyReport` sequence: gather → if no activity, skip → analyse → if null, fail → write → if empty, fail → upsert. Log each outcome.

- [ ] **Step 4: Run tests, full suite, typecheck, lint. Commit**

```bash
git add -A && git commit -m "feat(reports): writer agent and weekly report generation"
```

---

### Task 5: Cron route

**Files:**
- Create: `src/app/api/cron/weekly-report/route.ts`, `src/core/cron-auth.ts`, `tests/core/cron-auth.test.ts`, `vercel.json`
- Modify: `.env.example`

**Interfaces:**
- `@/core/cron-auth`: `isAuthorizedCron(req: Request, secret: string | undefined): boolean` — accepts Vercel's `Authorization: Bearer <CRON_SECRET>` header, fails closed when the secret is unset, timing-safe comparison.
- The route generates last week's report for the demo church and returns a JSON summary. `maxDuration` generous (300).

- [ ] **Step 1: Write the failing test `tests/core/cron-auth.test.ts`**

Fails closed with no configured secret; rejects a wrong secret, a missing header, a bare token with no `Bearer` prefix, and a length-mismatched token without throwing; accepts the correct one. Mirror the fail-closed and `timingSafeEqual` posture already used for the staff session and (previously) the ingest token.

- [ ] **Step 2: Run it, confirm it fails, implement `src/core/cron-auth.ts`.**

- [ ] **Step 3: Write the route**

```ts
// src/app/api/cron/weekly-report/route.ts — Node runtime (no edge export).
export const maxDuration = 300;

export async function GET(req: Request) { /* isAuthorizedCron → 401; else generate */ }
```

It must: reject unauthorised callers with 401 before doing any work; resolve the demo church; compute last week's window with `weekStart`; call `generateWeeklyReport`; return the result as JSON with an appropriate status (200 published, 200 with the reason when skipped, 500 when failed). Wrap the work so a DB failure returns a controlled JSON error rather than an uncaught rejection.

- [ ] **Step 4: Add `vercel.json`**

```json
{
  "crons": [{ "path": "/api/cron/weekly-report", "schedule": "0 9 * * 1" }]
}
```

Monday 09:00 UTC (06:00 America/Sao_Paulo) — the church reads it at the start of the week. Note in a comment or the brain that Vercel cron schedules are UTC.

- [ ] **Step 5: Add `CRON_SECRET=` (empty) to `.env.example`** with a note that Vercel sets this automatically for cron invocations and that an unset value means the endpoint refuses everything.

- [ ] **Step 6: Run tests, full suite, typecheck, lint, build. Commit**

```bash
git add -A && git commit -m "feat(reports): authenticated weekly cron endpoint"
```

---

### Task 6: Reports page in the staff area

**Files:**
- Create: `src/app/staff/(dashboard)/relatorios/page.tsx`, `src/app/staff/(dashboard)/relatorios/actions.ts` (+ a client component if needed)
- Modify: `src/app/staff/(dashboard)/layout.tsx` (nav entry), `src/app/staff/(dashboard)/page.tsx` (hub tile)

- [ ] **Step 1: Build the page**

Server component: `requireStaffContext()` → `listReports(getDb(), churchId, 12)`. Render the newest report's markdown body prominently (a small, safe renderer — do NOT add a markdown dependency or use `dangerouslySetInnerHTML`; render headings/paragraphs/lists from the text, or display it as pre-formatted prose styled to read well), the period it covers, and a list of earlier reports linking to their bodies. Show the structured `findings` beneath as a compact summary (top questions, unanswered, prayer themes) so a reader can see what the prose was built from — the same "show your work" principle as the agenda's provenance.

Empty state: explain in Portuguese that reports are generated weekly and none exists yet.

- [ ] **Step 2: Add a "Gerar agora" action**

A Server Action that runs `generateWeeklyReport` for last week on demand, so staff (and a portfolio viewer) do not have to wait for Monday. It must call `requireStaffContext()`, apply the same rate-limit and budget gating as the other AI-spending staff actions, return the `{ error }` / `{ ok }` shape the other forms use, and `revalidatePath`.

- [ ] **Step 3: Wire nav and hub tile.**

- [ ] **Step 4: Run tests, typecheck, lint, build. Commit**

```bash
git add -A && git commit -m "feat(reports): staff reports page with on-demand generation"
```

---

### Task 7: Portfolio landing page

**Files:**
- Modify: `src/app/page.tsx`
- Create: any small components it needs

- [ ] **Step 1: Replace the placeholder home page**

This is the front door for recruiters and clients. English. It must, in about a minute of reading:

- say what this is and that the church and all data are fictional;
- link prominently to the live chat (`/chat`) and to the staff area (`/staff`), noting the staff area needs a password;
- name the ten AI capabilities and where each one actually lives in the product, honestly — do not claim anything not built;
- explain the architecture decision the project is actually about: **one agent on the visitor's hot path; multi-agent only where a second pass earns its keep** (ingest: extractor → verifier; reporting: analyst → writer), and why;
- state the current status plainly, including that it is not yet deployed if that is still true when you build it (check `brain/status.md`);
- link to the repo, the design spec, and the plans.

Design it deliberately — this is a portfolio piece, so it should look considered, not like a scaffold. Use the existing Tailwind setup and the visual language already established in `/chat` and `/staff`. Responsive; readable on a phone. No external assets, no new dependencies.

- [ ] **Step 2: Verify in a browser**

Start the dev server explicitly from `/Users/rafaelpupiovieira/Desktop/Tech/ChurchChatBoxV2` (the tooling may default to the sibling `ChurchChatBox` repo — confirm the page is V2's). Load `/` at desktop and mobile widths, confirm no console errors, no horizontal overflow, and that the links resolve. Take a screenshot. Stop the server.

- [ ] **Step 3: Run tests, typecheck, lint, build. Commit**

```bash
git add -A && git commit -m "feat(site): a front door that explains the project honestly"
```

---

### Task 8: Final documentation pass

**Files:**
- Modify: `README.md`, `brain/status.md`, `brain/log/decisions.md`

- [ ] **Step 1: README** — add reporting to "what works today"; keep the honest deployment status; make sure the ten capabilities each map to something real.

- [ ] **Step 2: `brain/status.md`** — all four plans delivered; what remains (deployment, and anything deliberately unbuilt); the exact remaining deployment steps and the blocker.

- [ ] **Step 3: `brain/log/decisions.md`** — a dated Plan 4 section with the WHY: why analyst and writer are separate agents; why a report is never published from failed analysis; why the digest reports prayer THEMES rather than quotes (privacy); which model the writer uses and why; why the cron is Monday 09:00 UTC; and why activity gathering is bounded.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: record what the reporting pipeline settled"
```

---

## Self-Review Notes

- **Spec coverage:** AI Reporting Systems (Tasks 1–6) and the portfolio shell (Task 7) — the last two items outstanding from the design spec. With this plan merged, all ten capabilities in spec §3 exist.
- **Why a second multi-agent pipeline:** the spec names two, and this is the second. The analyst/writer split is the same argument as extractor/verifier — separating "decide what is true" from "say it well" keeps each honest, and neither sits on a latency-sensitive path.
- **Privacy is a first-class requirement here**, not a nicety: a weekly digest is the one artifact that aggregates everything visitors said. Themes, not quotes.
- **Deliberately not built:** emailing the report, multi-church fan-out in the cron (one demo tenant today), report editing, and PDF export.
