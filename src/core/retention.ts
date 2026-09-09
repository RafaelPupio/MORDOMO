import { and, eq, gte, inArray, like, lt, not, notExists, or, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { conversations, messages, prayerRequests, rateLimits, tickets } from '@/db/schema';

/**
 * Data retention: the one thing a church cannot do today is let old conversations go.
 * Prayer requests and pastoral tickets carry health, family and phone details, and until
 * this job existed every row lived forever.
 *
 * The policy is deliberately INERT until someone chooses it. `RETENTION_DAYS` unset,
 * unparseable, or below RETENTION_MIN_DAYS all mean "dry run": the job counts what it
 * would remove and removes nothing. A typo in an environment variable must never empty a
 * church. That fail-closed direction is the opposite of the budget gate's, and for the
 * same reason — the irreversible action is the one that needs the explicit value.
 *
 * What is removed, once enabled, all scoped by church and all older than the cutoff:
 *  - tickets that are answered or closed; prayer requests that are done. An OPEN ticket or
 *    a NEW/praying request is never removed, however old — it is unfinished pastoral work.
 *  - conversations with no activity since the cutoff (started before it, no message at or
 *    after it) and nothing still pointing at them, with their messages. A conversation an
 *    open ticket still references survives with the ticket.
 *  - rate-limit windows older than two days (operational rows, not personal data).
 * Never removed: documents, chunks, events (the church's own knowledge), reports, and
 * `usage_ledger` (it is the bill).
 */
export const RETENTION_MIN_DAYS = 30;
/** Ten years. Above this the cutoff stops being a date Postgres accepts, and the intent
 *  is clearly not a retention policy. */
export const RETENTION_MAX_DAYS = 3650;
const RATE_LIMIT_WINDOW_KEEP_MS = 2 * 24 * 60 * 60 * 1000;
const DELETE_BATCH = 500;

export function isValidRetentionDays(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= RETENTION_MIN_DAYS && n <= RETENTION_MAX_DAYS;
}

export function parseRetentionDays(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return isValidRetentionDays(n) ? n : null;
}

export type RetentionCounts = {
  tickets: number;
  prayerRequests: number;
  conversations: number;
  messages: number;
  rateLimitWindows: number;
};

export type RetentionResult = {
  /** True when nothing was deleted — either the policy is not configured or a preview was asked for. */
  dryRun: boolean;
  retentionDays: number | null;
  cutoff: Date | null;
  counts: RetentionCounts;
};

export type RetentionInput = {
  organizationId: string;
  /** null disables deletion; the counts are still computed against `previewDays`. */
  retentionDays: number | null;
  /** Used to compute the preview cutoff when `retentionDays` is null (staff page). */
  previewDays?: number;
  /** Force a count-only run even when a policy is configured. */
  preview?: boolean;
  now?: Date;
  /** Conversations deleted per statement; only tests lower it. */
  batchSize?: number;
};

const EMPTY: RetentionCounts = { tickets: 0, prayerRequests: 0, conversations: 0, messages: 0, rateLimitWindows: 0 };

/** The staff page's entry point: identical counts, structurally unable to delete. */
export async function previewRetention(
  db: Db,
  input: Omit<RetentionInput, 'preview'>,
): Promise<RetentionResult> {
  return runRetention(db, { ...input, preview: true });
}

export async function runRetention(db: Db, input: RetentionInput): Promise<RetentionResult> {
  const now = input.now ?? new Date();
  // The floor is enforced HERE as well as in parseRetentionDays: a caller that bypasses
  // the parser (a cast, a future config source) must still be unable to purge with a
  // nonsense period. Anything invalid is a dry run, never a delete.
  const configured = isValidRetentionDays(input.retentionDays) ? input.retentionDays : null;
  if (input.retentionDays != null && configured === null) {
    console.warn('retention: ignoring an invalid period and running dry', { retentionDays: input.retentionDays });
  }
  const days = configured ?? (isValidRetentionDays(input.previewDays) ? input.previewDays : null);
  const dryRun = input.preview === true || configured === null;
  if (days === null) return { dryRun: true, retentionDays: configured, cutoff: null, counts: EMPTY };

  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rateCutoff = new Date(now.getTime() - RATE_LIMIT_WINDOW_KEEP_MS);
  const organizationId = input.organizationId;
  // rate_limits has no organization_id; the tenant lives in the key. Matched by exact shape
  // (`chat:<organizationId>:<visitor>`, `ingest:<organizationId>`, `staff-suggest:<organizationId>`,
  // `report-generate:<organizationId>`), not by substring: a visitor can choose their own cookie
  // value, and choosing another church's UUID must not move a window between tenants.
  // Without any scoping, church A's pass deleted church B's stale windows.
  const staleWindowWhere = and(
    lt(rateLimits.windowStart, rateCutoff),
    or(
      like(rateLimits.key, `chat:${organizationId}:%`),
      inArray(rateLimits.key, [`ingest:${organizationId}`, `staff-suggest:${organizationId}`, `report-generate:${organizationId}`]),
    ),
  );

  // Resolved rows are aged by updated_at: a thread answered yesterday is yesterday's work
  // however old the thread. Every comparison below goes through a Drizzle operator, never
  // a raw `sql\`${date}\`` fragment — the driver would serialise a Date in the process's
  // local time and the cutoff would move with the server's TZ.
  const ticketWhere = and(
    eq(tickets.organizationId, organizationId),
    inArray(tickets.status, ['answered', 'closed']),
    lt(tickets.updatedAt, cutoff),
  );
  const prayerWhere = and(
    eq(prayerRequests.organizationId, organizationId),
    eq(prayerRequests.status, 'done'),
    lt(prayerRequests.updatedAt, cutoff),
  );
  // "Eligible" is church-scoped exactly like the deletes above: the preview may only treat
  // a referencing row as about-to-vanish when THIS run will actually delete it. The outer
  // reference checks below stay unscoped on purpose.
  const ticketEligible = and(eq(tickets.organizationId, organizationId), inArray(tickets.status, ['answered', 'closed']), lt(tickets.updatedAt, cutoff))!;
  const prayerEligible = and(eq(prayerRequests.organizationId, organizationId), eq(prayerRequests.status, 'done'), lt(prayerRequests.updatedAt, cutoff))!;

  // A conversation is eligible when it started before the cutoff, has no message at or
  // after it, and nothing still points at it that is itself ineligible. The reference
  // checks are deliberately NOT church-scoped: a row from any church that still points at
  // the conversation must keep it (deleting it would break that row's FK).
  const conversationWhere = (afterDeletes: boolean) => and(
    eq(conversations.organizationId, organizationId),
    lt(conversations.startedAt, cutoff),
    notExists(db.select({ one: sql`1` }).from(messages)
      .where(and(eq(messages.conversationId, conversations.id), gte(messages.createdAt, cutoff)))),
    notExists(db.select({ one: sql`1` }).from(tickets).where(and(
      eq(tickets.conversationId, conversations.id),
      ...(afterDeletes ? [] : [not(ticketEligible)]),
    ))),
    notExists(db.select({ one: sql`1` }).from(prayerRequests).where(and(
      eq(prayerRequests.conversationId, conversations.id),
      ...(afterDeletes ? [] : [not(prayerEligible)]),
    ))),
  );

  const count = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);

  if (dryRun) {
    const eligibleConversations = db.select({ id: conversations.id }).from(conversations).where(conversationWhere(false));
    const counts: RetentionCounts = {
      tickets: await count(db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(ticketWhere)),
      prayerRequests: await count(db.select({ n: sql<number>`count(*)::int` }).from(prayerRequests).where(prayerWhere)),
      conversations: await count(db.select({ n: sql<number>`count(*)::int` }).from(conversations).where(conversationWhere(false))),
      messages: await count(db.select({ n: sql<number>`count(*)::int` }).from(messages)
        .where(and(inArray(messages.conversationId, eligibleConversations), lt(messages.createdAt, cutoff)))),
      rateLimitWindows: await count(db.select({ n: sql<number>`count(*)::int` }).from(rateLimits).where(staleWindowWhere)),
    };
    return { dryRun: true, retentionDays: configured, cutoff, counts };
  }

  const deletedTickets = await db.delete(tickets).where(ticketWhere).returning({ id: tickets.id });
  const deletedPrayers = await db.delete(prayerRequests).where(prayerWhere).returning({ id: prayerRequests.id });
  const eligible = await db.select({ id: conversations.id }).from(conversations).where(conversationWhere(true));
  let deletedMessages = 0;
  let deletedConversations = 0;
  // Batched, and re-checked at delete time: there is no transaction on neon-http, so a
  // visitor who resumes an old thread between the select and the delete keeps the message
  // they just sent, and the conversation survives because it is no longer empty. Bounded
  // batches also keep the bind-parameter count far below Postgres's 65535.
  const batch = input.batchSize ?? DELETE_BATCH;
  for (let i = 0; i < eligible.length; i += batch) {
    const ids = eligible.slice(i, i + batch).map((c) => c.id);
    // A thread that got a message since the select is kept WHOLE: the policy keeps active
    // conversations, and half a history is worse than either all or none of it.
    const resumedSince = db.select({ one: sql`1` }).from(messages)
      .where(and(eq(messages.conversationId, conversations.id), gte(messages.createdAt, cutoff)));
    const stillQuiet = db.select({ id: conversations.id }).from(conversations)
      .where(and(inArray(conversations.id, ids), notExists(resumedSince)));
    deletedMessages += (await db.delete(messages)
      .where(and(inArray(messages.conversationId, stillQuiet), lt(messages.createdAt, cutoff)))
      .returning({ id: messages.id })).length;
    deletedConversations += (await db.delete(conversations)
      .where(and(
        inArray(conversations.id, ids),
        notExists(db.select({ one: sql`1` }).from(messages).where(eq(messages.conversationId, conversations.id))),
      ))
      .returning({ id: conversations.id })).length;
  }
  const deletedWindows = (await db.delete(rateLimits).where(staleWindowWhere).returning({ key: rateLimits.key })).length;

  return {
    dryRun: false,
    retentionDays: configured,
    cutoff,
    counts: {
      tickets: deletedTickets.length,
      prayerRequests: deletedPrayers.length,
      conversations: deletedConversations,
      messages: deletedMessages,
      rateLimitWindows: deletedWindows,
    },
  };
}
