import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { textFromParts } from '@/core/message-text';
import type { Db } from '@/db/client';
import { messages, prayerRequests, tickets, usageLedger } from '@/db/schema';

// The analyst agent (Plan 4) reads this whole struct into a single prompt. A church having an
// unusually busy week must never turn into an unbounded prompt, so every SAMPLE list below
// (visitorQuestions, prayerRequests, ticketTopics) is capped at MAX_ITEMS_PER_KIND items —
// newest first, since the analyst cares most about the shape of RECENT activity, not a full
// audit trail — and each item is truncated to MAX_ITEM_CHARS so one pathologically long
// message can't blow the budget on its own. `counts` is NOT capped by either bound: those
// numbers come straight from SQL aggregates over the whole window, so the analyst still learns
// the true volume of a week even when the sample lists were trimmed to fit.
export const MAX_ITEMS_PER_KIND = 100;
export const MAX_ITEM_CHARS = 400;

export type WeekActivity = {
  periodStart: Date;
  periodEnd: Date;
  visitorQuestions: string[];
  prayerRequests: string[];
  ticketTopics: string[];
  counts: {
    conversations: number;
    visitorMessages: number;
    prayerRequests: number;
    tickets: number;
  };
  costUsd: number;
};

function truncate(text: string): string {
  return text.length > MAX_ITEM_CHARS ? `${text.slice(0, MAX_ITEM_CHARS)}…` : text;
}

/**
 * Gathers one tenant's real activity for `[periodStart, periodEnd)` — half-open: a row exactly
 * at `periodEnd` belongs to the NEXT window and is excluded, a row exactly at `periodStart` is
 * included. Purely deterministic and read-only (no model calls) — this is the raw material the
 * analyst agent reasons over, not the analysis itself.
 *
 * Every query below is scoped to `organizationId` AND the window in SQL, and every list-producing
 * query applies `LIMIT MAX_ITEMS_PER_KIND` in SQL (not after fetching everything) — a busy week
 * never loads unbounded rows into memory just to gather one digest. `counts`, by contrast, come
 * from plain SQL aggregates (COUNT/SUM), which never load per-row data at all.
 */
export async function gatherWeekActivity(
  db: Db,
  organizationId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<WeekActivity> {
  const [
    userMessageRows,
    visitorMessagesCountRows,
    conversationsCountRows,
    prayerRows,
    prayerCountRows,
    ticketRows,
    ticketCountRows,
    costRows,
  ] = await Promise.all([
    // Newest-first, SQL-side LIMIT: the sample of questions the analyst actually reads.
    db
      .select({ parts: messages.parts })
      .from(messages)
      .where(and(
        eq(messages.organizationId, organizationId),
        eq(messages.role, 'user'),
        gte(messages.createdAt, periodStart),
        lt(messages.createdAt, periodEnd),
      ))
      .orderBy(desc(messages.createdAt))
      .limit(MAX_ITEMS_PER_KIND),

    // The TRUE count of visitor messages in the window, uncapped.
    db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(and(
        eq(messages.organizationId, organizationId),
        eq(messages.role, 'user'),
        gte(messages.createdAt, periodStart),
        lt(messages.createdAt, periodEnd),
      )),

    // Distinct conversations that had at least one VISITOR message in the window — mirrors
    // every sibling count below (visitorMessages, prayerRequests, tickets), which all count
    // visitor-submitted activity, not staff activity. Without `role = 'user'` here, a
    // conversation where only a staff reply landed this week would inflate this count while
    // contributing zero visitor messages — "5 conversations, but only 2 visitor messages" in
    // a digest.
    db
      .select({ count: sql<number>`count(distinct ${messages.conversationId})` })
      .from(messages)
      .where(and(
        eq(messages.organizationId, organizationId),
        eq(messages.role, 'user'),
        gte(messages.createdAt, periodStart),
        lt(messages.createdAt, periodEnd),
      )),

    db
      .select({ request: prayerRequests.request })
      .from(prayerRequests)
      .where(and(
        eq(prayerRequests.organizationId, organizationId),
        gte(prayerRequests.createdAt, periodStart),
        lt(prayerRequests.createdAt, periodEnd),
      ))
      .orderBy(desc(prayerRequests.createdAt))
      .limit(MAX_ITEMS_PER_KIND),

    db
      .select({ count: sql<number>`count(*)` })
      .from(prayerRequests)
      .where(and(
        eq(prayerRequests.organizationId, organizationId),
        gte(prayerRequests.createdAt, periodStart),
        lt(prayerRequests.createdAt, periodEnd),
      )),

    db
      .select({ topic: tickets.topic })
      .from(tickets)
      .where(and(
        eq(tickets.organizationId, organizationId),
        gte(tickets.createdAt, periodStart),
        lt(tickets.createdAt, periodEnd),
      ))
      .orderBy(desc(tickets.createdAt))
      .limit(MAX_ITEMS_PER_KIND),

    db
      .select({ count: sql<number>`count(*)` })
      .from(tickets)
      .where(and(
        eq(tickets.organizationId, organizationId),
        gte(tickets.createdAt, periodStart),
        lt(tickets.createdAt, periodEnd),
      )),

    // A single number — no cap needed, mirrors usageSummary's coalesce(sum(...), 0) so a
    // church with zero spend in the window gets 0, not null.
    db
      .select({ total: sql<number>`coalesce(sum(${usageLedger.costUsd}), 0)` })
      .from(usageLedger)
      .where(and(
        eq(usageLedger.organizationId, organizationId),
        gte(usageLedger.createdAt, periodStart),
        lt(usageLedger.createdAt, periodEnd),
      )),
  ]);

  // Text extraction happens in code (SQL can't walk the parts array), but only over the
  // already SQL-capped set of rows. A message with no text part (e.g. only a tool call)
  // yields '' from textFromParts and is filtered out here — it still counted toward
  // counts.visitorMessages above, it just contributes nothing to the sample list.
  const visitorQuestions = userMessageRows
    .map((row) => textFromParts(row.parts).trim())
    .filter((text) => text.length > 0)
    .map(truncate);

  return {
    periodStart,
    periodEnd,
    visitorQuestions,
    prayerRequests: prayerRows.map((r) => truncate(r.request)),
    ticketTopics: ticketRows.map((r) => truncate(r.topic)),
    counts: {
      conversations: Number(conversationsCountRows[0].count),
      visitorMessages: Number(visitorMessagesCountRows[0].count),
      prayerRequests: Number(prayerCountRows[0].count),
      tickets: Number(ticketCountRows[0].count),
    },
    costUsd: Number(costRows[0].total),
  };
}
