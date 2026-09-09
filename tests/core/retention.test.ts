import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { isValidRetentionDays, parseRetentionDays, previewRetention, RETENTION_MAX_DAYS, RETENTION_MIN_DAYS, runRetention } from '@/core/retention';
import { organizations, conversations, documents, events, messages, prayerRequests, rateLimits, reports, tickets, usageLedger } from '@/db/schema';
import { createTestDb, seedOrganization } from '../helpers/db';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-08T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const CUTOFF_90 = ago(90);

// Every row this job may touch carries a person's words. The policy must be inert until
// chosen, must never take an unfinished pastoral thread, must age resolved work by when it
// was resolved, and must never cross a church.
describe('parseRetentionDays', () => {
  it('is null — dry run — for anything that is not a deliberate, safe number', () => {
    for (const raw of [undefined, '', 'abc', 'NaN', '7', String(RETENTION_MIN_DAYS - 1), '90.5', '-90', '1e7', '100000000', 'Infinity', String(RETENTION_MAX_DAYS + 1)]) {
      expect(parseRetentionDays(raw), `raw=${raw}`).toBeNull();
    }
  });

  it('accepts an integer inside the bounds', () => {
    expect(parseRetentionDays(String(RETENTION_MIN_DAYS))).toBe(RETENTION_MIN_DAYS);
    expect(parseRetentionDays('365')).toBe(365);
    expect(parseRetentionDays(String(RETENTION_MAX_DAYS))).toBe(RETENTION_MAX_DAYS);
    expect(isValidRetentionDays(0)).toBe(false);
  });
});

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

// One church's world. Comments name what each row is FOR: every "kept" row exists because
// a mutation of the policy would otherwise pass unnoticed.
async function seedWorld(db: TestDb, organizationId: string, p = 'a') {
  const id = (n: number) => { const h = n.toString(16); return `${p}${h.repeat(7)}-${h.repeat(4)}-4${h.repeat(3)}-8${h.repeat(3)}-${h.repeat(12)}`; };
  const conv = async (n: number, startedAt: Date, messageAt: Date[]) => {
    await db.insert(conversations).values({ id: id(n), organizationId, visitorKey: `v-${p}${n}`, startedAt });
    for (const at of messageAt) {
      await db.insert(messages).values({ organizationId, conversationId: id(n), role: 'user', parts: [{ type: 'text', text: 'x' }], createdAt: at });
    }
    return id(n);
  };
  await conv(1, ago(200), [ago(200), ago(199)]);                 // old, quiet, unreferenced → removed (2 messages)
  await conv(2, ago(200), [ago(200), ago(3)]);                   // old start, recent message → kept
  const c3 = await conv(3, ago(200), [ago(200)]);                // old, quiet, but an OPEN ticket → kept
  await db.insert(tickets).values({ organizationId, conversationId: c3, topic: 'open and old', status: 'open', createdAt: ago(200), updatedAt: ago(200) });
  const c4 = await conv(4, ago(200), [ago(200)]);                // old, quiet, resolved ticket + done prayer, both long ago → all three removed
  await db.insert(tickets).values({ organizationId, conversationId: c4, topic: 'closed long ago', status: 'closed', createdAt: ago(200), updatedAt: ago(150) });
  await db.insert(prayerRequests).values({ organizationId, conversationId: c4, request: 'done long ago', status: 'done', createdAt: ago(200), updatedAt: ago(150) });
  await conv(5, ago(2), [ago(2)]);                               // recent → kept
  const c6 = await conv(6, ago(200), [ago(200)]);                // old, quiet, a PRAYING request still points at it → kept
  await db.insert(prayerRequests).values({ organizationId, conversationId: c6, request: 'still praying, old thread', status: 'praying', createdAt: ago(200), updatedAt: ago(200) });
  await conv(7, ago(10), []);                                    // started after the cutoff, no messages at all → kept (startedAt guard)
  await conv(8, ago(200), [CUTOFF_90]);                          // last message EXACTLY at the cutoff → kept (>= boundary)
  const c9 = await conv(9, ago(200), [ago(200)]);                // old thread ANSWERED YESTERDAY → ticket and thread kept
  await db.insert(tickets).values({ organizationId, conversationId: c9, topic: 'answered yesterday on an old thread', status: 'answered', createdAt: ago(200), updatedAt: ago(1) });
  const c11 = await conv(11, ago(200), [ago(200)]);              // old thread whose prayer was marked DONE yesterday → both kept
  await db.insert(prayerRequests).values({ organizationId, conversationId: c11, request: 'done yesterday on an old thread', status: 'done', createdAt: ago(200), updatedAt: ago(1) });
  // Standalone rows.
  await db.insert(prayerRequests).values({ organizationId, request: 'still praying', status: 'praying', createdAt: ago(400), updatedAt: ago(400) });   // unfinished → kept
  await db.insert(prayerRequests).values({ organizationId, request: 'done yesterday, opened long ago', status: 'done', createdAt: ago(200), updatedAt: ago(1) }); // resolved recently → kept
  await db.insert(tickets).values({ organizationId, topic: 'answered recently', status: 'answered', createdAt: ago(5), updatedAt: ago(5) });            // recent → kept
  // Exactly AT the cutoff: strictly-before semantics keep all of these.
  await db.insert(tickets).values({ organizationId, topic: 'resolved exactly at the cutoff', status: 'closed', createdAt: ago(200), updatedAt: CUTOFF_90 });
  await db.insert(prayerRequests).values({ organizationId, request: 'done exactly at the cutoff', status: 'done', createdAt: ago(200), updatedAt: CUTOFF_90 });
  await conv(10, CUTOFF_90, []);                                 // started exactly at the cutoff, empty → kept
  await db.insert(rateLimits).values({ key: `ingest:${organizationId}`, windowStart: ago(2), count: 1 }); // exactly at the window cutoff → kept
  // Rate-limit windows: one stale, one current — the tenant is only in the key.
  await db.insert(rateLimits).values({ key: `chat:${organizationId}:old`, windowStart: ago(3), count: 5 });
  await db.insert(rateLimits).values({ key: `chat:${organizationId}:now`, windowStart: ago(0), count: 1 });
  // Never touched, however old: the church's knowledge, its reports, and the bill.
  const [doc] = await db.insert(documents).values({ organizationId, title: 'Boletim antigo', kind: 'bulletin', createdAt: ago(400) }).returning();
  await db.insert(events).values({ organizationId, title: 'Evento antigo', startsAt: ago(400), verified: true, sourceDocumentId: doc.id });
  await db.insert(reports).values({ organizationId, periodStart: ago(400), periodEnd: ago(393), findings: {}, body: 'antigo', createdAt: ago(393) });
  await db.insert(usageLedger).values({ organizationId, feature: 'chat.reply', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0.001, createdAt: ago(400) });
}

const EXPECTED = { tickets: 1, prayerRequests: 1, conversations: 2, messages: 3, rateLimitWindows: 1 };
const KEPT_CONVERSATIONS = (p: string) => [2, 3, 5, 6, 7, 8, 9, 10, 11].map((n) => { const h = n.toString(16); return `${p}${h.repeat(7)}-${h.repeat(4)}-4${h.repeat(3)}-8${h.repeat(3)}-${h.repeat(12)}`; }).sort();

async function untouchedRows(db: TestDb, organizationId: string) {
  return {
    documents: (await db.select().from(documents).where(eq(documents.organizationId, organizationId))).length,
    events: (await db.select().from(events).where(eq(events.organizationId, organizationId))).length,
    reports: (await db.select().from(reports).where(eq(reports.organizationId, organizationId))).length,
    ledger: (await db.select().from(usageLedger).where(eq(usageLedger.organizationId, organizationId))).length,
  };
}

describe('runRetention', () => {
  it('with no policy configured counts what it would remove and removes nothing', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    await seedWorld(db, church.id);

    const r = await runRetention(db, { organizationId: church.id, retentionDays: null, previewDays: 90, now: NOW });
    expect(r.dryRun).toBe(true);
    expect(r.cutoff).toEqual(CUTOFF_90);
    expect(r.counts).toEqual(EXPECTED);

    expect(await db.select().from(conversations)).toHaveLength(11);
    expect(await db.select().from(messages)).toHaveLength(11);
    expect(await db.select().from(tickets)).toHaveLength(5);
    expect(await db.select().from(prayerRequests)).toHaveLength(6);
    expect(await db.select().from(rateLimits)).toHaveLength(3);
  });

  it('removes exactly the eligible rows once a period is configured, and is idempotent', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    await seedWorld(db, church.id);

    const r = await runRetention(db, { organizationId: church.id, retentionDays: 90, now: NOW });
    expect(r.dryRun).toBe(false);
    expect(r.counts).toEqual(EXPECTED);

    expect((await db.select({ id: conversations.id }).from(conversations)).map((c) => c.id).sort()).toEqual(KEPT_CONVERSATIONS('a'));
    expect((await db.select().from(tickets)).map((t) => t.topic).sort()).toEqual(['answered recently', 'answered yesterday on an old thread', 'open and old', 'resolved exactly at the cutoff']);
    expect((await db.select().from(prayerRequests)).map((p) => p.request).sort()).toEqual(['done exactly at the cutoff', 'done yesterday on an old thread', 'done yesterday, opened long ago', 'still praying', 'still praying, old thread']);
    expect((await db.select().from(rateLimits)).map((w) => w.key).sort()).toEqual([`chat:${church.id}:now`, `ingest:${church.id}`].sort());
    expect(await untouchedRows(db, church.id)).toEqual({ documents: 1, events: 1, reports: 1, ledger: 1 });

    const again = await runRetention(db, { organizationId: church.id, retentionDays: 90, now: NOW });
    expect(again.counts).toEqual({ tickets: 0, prayerRequests: 0, conversations: 0, messages: 0, rateLimitWindows: 0 });
  });

  it('never crosses a church — rows, references, and rate-limit windows alike', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db, 'Igreja A');
    const [b] = await db.insert(organizations).values({ name: 'Igreja B', slug: 'igreja-b' }).returning();
    await seedWorld(db, a.id, 'a');
    await seedWorld(db, b.id, 'b');

    const preview = await runRetention(db, { organizationId: a.id, retentionDays: null, previewDays: 90, now: NOW });
    expect(preview.counts).toEqual(EXPECTED); // b's stale window and rows are not counted for a

    await runRetention(db, { organizationId: a.id, retentionDays: 90, now: NOW });
    expect(await db.select().from(conversations).where(eq(conversations.organizationId, b.id))).toHaveLength(11);
    expect(await db.select().from(tickets).where(eq(tickets.organizationId, b.id))).toHaveLength(5);
    expect(await db.select().from(prayerRequests).where(eq(prayerRequests.organizationId, b.id))).toHaveLength(6);
    expect((await db.select().from(rateLimits)).map((w) => w.key).sort()).toEqual([`chat:${a.id}:now`, `ingest:${a.id}`, `chat:${b.id}:now`, `chat:${b.id}:old`, `ingest:${b.id}`].sort());
    expect((await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.organizationId, a.id))).map((c) => c.id).sort()).toEqual(KEPT_CONVERSATIONS('a'));
  });

  it('a preview never deletes even when a policy is configured', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    await seedWorld(db, church.id);
    const r = await previewRetention(db, { organizationId: church.id, retentionDays: 90, now: NOW });
    expect(r.dryRun).toBe(true);
    expect(r.counts).toEqual(EXPECTED);
    expect(await db.select().from(conversations)).toHaveLength(11);
    expect(await db.select().from(tickets)).toHaveLength(5);
  });

  it('refuses to purge on a period that bypassed the parser', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    await seedWorld(db, church.id);
    for (const bad of [0, -1, 7, RETENTION_MIN_DAYS - 1, RETENTION_MAX_DAYS + 1, Number.NaN, undefined]) {
      const r = await runRetention(db, { organizationId: church.id, retentionDays: bad as number, now: NOW });
      expect(r.dryRun, `retentionDays=${bad}`).toBe(true);
    }
    expect(await db.select().from(conversations)).toHaveLength(11);
  });

  // #4 from the review: both real callers pass retentionDays AND previewDays. The
  // configured period must win; the preview horizon is only for the dry run.
  it('purges at the configured period, never at the preview horizon', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    await seedWorld(db, church.id);
    const r = await runRetention(db, { organizationId: church.id, retentionDays: 365, previewDays: 90, now: NOW });
    expect(r.dryRun).toBe(false);
    expect(r.cutoff).toEqual(ago(365));
    expect(r.counts).toEqual({ tickets: 0, prayerRequests: 0, conversations: 0, messages: 0, rateLimitWindows: 1 });
    expect(await db.select().from(conversations)).toHaveLength(11);
  });

  // The reference checks are deliberately NOT church-scoped: a row from ANY church that
  // still points at a conversation must keep it, or that row's FK breaks.
  it('keeps a conversation that another church\'s open ticket still references', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db, 'Igreja A');
    const [b] = await db.insert(organizations).values({ name: 'Igreja B', slug: 'igreja-b' }).returning();
    await db.insert(conversations).values({ id: 'c0000000-0000-4000-8000-000000000000', organizationId: a.id, visitorKey: 'v', startedAt: ago(200) });
    await db.insert(messages).values({ organizationId: a.id, conversationId: 'c0000000-0000-4000-8000-000000000000', role: 'user', parts: [], createdAt: ago(200) });
    await db.insert(tickets).values({ organizationId: b.id, conversationId: 'c0000000-0000-4000-8000-000000000000', topic: 'cross-church, open', status: 'open', createdAt: ago(200), updatedAt: ago(200) });

    const preview = await runRetention(db, { organizationId: a.id, retentionDays: null, previewDays: 90, now: NOW });
    expect(preview.counts.conversations).toBe(0);
    await runRetention(db, { organizationId: a.id, retentionDays: 90, now: NOW });
    expect(await db.select().from(conversations)).toHaveLength(1);
  });

  // #9: the batch loop is what keeps the bind-parameter count bounded; with a batch of 1
  // the two eligible conversations must both still go.
  it('deletes across batches without skipping', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    await seedWorld(db, church.id);
    const r = await runRetention(db, { organizationId: church.id, retentionDays: 90, now: NOW, batchSize: 1 });
    expect(r.counts.conversations).toBe(2);
    expect(r.counts.messages).toBe(3);
  });

  // A visitor chooses their own cookie; choosing another church's UUID must not move a
  // rate-limit window between tenants.
  it('does not count or purge a window whose visitor segment is another church\'s id', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db, 'Igreja A');
    const [b] = await db.insert(organizations).values({ name: 'Igreja B', slug: 'igreja-b' }).returning();
    await db.insert(rateLimits).values({ key: `chat:${a.id}:${b.id}`, windowStart: ago(3), count: 1 });
    expect((await runRetention(db, { organizationId: b.id, retentionDays: null, previewDays: 90, now: NOW })).counts.rateLimitWindows).toBe(0);
    await runRetention(db, { organizationId: b.id, retentionDays: 90, now: NOW });
    expect(await db.select().from(rateLimits)).toHaveLength(1);
    expect((await runRetention(db, { organizationId: a.id, retentionDays: 90, now: NOW })).counts.rateLimitWindows).toBe(1);
  });

  // The preview must not promise a removal the real run will not make: another church's
  // resolved ticket still references the conversation, and this run will not delete it.
  it('preview and purge agree when another church\'s resolved ticket references the thread', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db, 'Igreja A');
    const [b] = await db.insert(organizations).values({ name: 'Igreja B', slug: 'igreja-b' }).returning();
    await db.insert(conversations).values({ id: 'c0000000-0000-4000-8000-000000000000', organizationId: a.id, visitorKey: 'v', startedAt: ago(200) });
    await db.insert(messages).values({ organizationId: a.id, conversationId: 'c0000000-0000-4000-8000-000000000000', role: 'user', parts: [], createdAt: ago(200) });
    await db.insert(tickets).values({ organizationId: b.id, conversationId: 'c0000000-0000-4000-8000-000000000000', topic: 'closed by b', status: 'closed', createdAt: ago(200), updatedAt: ago(150) });
    const preview = await runRetention(db, { organizationId: a.id, retentionDays: null, previewDays: 90, now: NOW });
    const real = await runRetention(db, { organizationId: a.id, retentionDays: 90, now: NOW });
    expect(preview.counts.conversations).toBe(0);
    expect(real.counts).toMatchObject({ conversations: 0, messages: 0 });
    expect(await db.select().from(conversations)).toHaveLength(1);
  });

  // No transaction on neon-http: a visitor who resumes an old thread between the
  // eligibility select and the deletes must keep the WHOLE thread.
  it('a thread resumed between the select and the delete is kept whole', async () => {
    const real = await createTestDb();
    const church = await seedOrganization(real);
    await seedWorld(real, church.id);
    const c1 = 'a1111111-1111-4111-8111-111111111111';
    let intercepted = false;
    const db = new Proxy(real, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== 'delete') return typeof value === 'function' ? value.bind(target) : value;
        return (table: unknown) => {
          const builder = target.delete(table as never);
          if (table !== messages || intercepted) return builder;
          intercepted = true;
          return {
            where: (w: unknown) => ({
              returning: async (r: unknown) => {
                await target.insert(messages).values({ organizationId: church.id, conversationId: c1, role: 'user', parts: [{ type: 'text', text: 'voltei' }], createdAt: ago(0) });
                return (builder.where(w as never) as unknown as { returning: (x: unknown) => Promise<unknown[]> }).returning(r);
              },
            }),
          };
        };
      },
    }) as typeof real;

    const r = await runRetention(db, { organizationId: church.id, retentionDays: 90, now: NOW });
    expect(intercepted).toBe(true);
    expect(r.counts.conversations).toBe(1);                     // only a4 goes; a1 was resumed
    expect(r.counts.messages).toBe(1);                          // a4's one message
    const kept = await real.select().from(messages).where(eq(messages.conversationId, c1));
    expect(kept).toHaveLength(3);                               // both old messages AND the new one
  });
});
