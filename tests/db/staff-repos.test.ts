import { describe, expect, it } from 'vitest';
import { createPrayerRequest, listPrayerRequests, setPrayerStatus } from '@/db/repo/prayer';
import { createTicket, getTicket, listTickets, saveSuggestedReply, setTicketStatus } from '@/db/repo/tickets';
import { usageSummary } from '@/db/repo/usage';
import { recordUsage } from '@/ai/usage';
import { CHAT_MODEL, FAST_MODEL } from '@/ai/pricing';
import { budgets } from '@/db/schema';
import { createTestDb, seedOrganization } from '../helpers/db';

describe('prayer inbox', () => {
  it('moves a request through statuses, scoped to its church', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db, 'A');
    const b = await seedOrganization(db, 'B');
    const req = await createPrayerRequest(db, { organizationId: a.id, request: 'Pela minha avó' });

    await setPrayerStatus(db, a.id, req.id, 'praying');
    expect((await listPrayerRequests(db, a.id))[0].status).toBe('praying');

    // Another church cannot touch it.
    await setPrayerStatus(db, b.id, req.id, 'done');
    expect((await listPrayerRequests(db, a.id))[0].status).toBe('praying');
  });

  it('filters by status when asked', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const one = await createPrayerRequest(db, { organizationId: church.id, request: 'Um' });
    await createPrayerRequest(db, { organizationId: church.id, request: 'Dois' });
    await setPrayerStatus(db, church.id, one.id, 'done');
    expect(await listPrayerRequests(db, church.id, 'new')).toHaveLength(1);
    expect(await listPrayerRequests(db, church.id, 'done')).toHaveLength(1);
    expect(await listPrayerRequests(db, church.id)).toHaveLength(2);
  });
});

describe('ticket inbox', () => {
  it('stores a suggested reply and moves status, scoped to its church', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db, 'A');
    const b = await seedOrganization(db, 'B');
    const ticket = await createTicket(db, { organizationId: a.id, topic: 'Agendar batismo' });

    await saveSuggestedReply(db, a.id, ticket.id, 'Olá! Podemos agendar...');
    expect((await getTicket(db, a.id, ticket.id))?.suggestedReply).toContain('agendar');

    expect(await getTicket(db, b.id, ticket.id)).toBeUndefined();
    await setTicketStatus(db, b.id, ticket.id, 'closed');
    expect((await getTicket(db, a.id, ticket.id))?.status).toBe('open');

    await setTicketStatus(db, a.id, ticket.id, 'answered');
    expect((await listTickets(db, a.id))[0].status).toBe('answered');
  });
});

describe('usageSummary', () => {
  it('totals this month per feature for one tenant only', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db, 'A');
    const b = await seedOrganization(db, 'B');
    await db.insert(budgets).values({ organizationId: a.id, monthlyUsd: 40 });

    await recordUsage(db, { organizationId: a.id, feature: 'chat.reply', model: CHAT_MODEL, inputTokens: 1_000_000, outputTokens: 0 }); // $3
    await recordUsage(db, { organizationId: a.id, feature: 'ingest.extract', model: FAST_MODEL, inputTokens: 1_000_000, outputTokens: 0 }); // $1
    await recordUsage(db, { organizationId: b.id, feature: 'chat.reply', model: CHAT_MODEL, inputTokens: 1_000_000, outputTokens: 0 });

    const summary = await usageSummary(db, a.id);
    expect(summary.totalUsd).toBeCloseTo(4);
    expect(summary.monthlyUsd).toBe(40);
    const chat = summary.byFeature.find((f) => f.feature === 'chat.reply');
    expect(chat?.costUsd).toBeCloseTo(3);
    expect(chat?.calls).toBe(1);
    expect(summary.byFeature.map((f) => f.feature)).not.toContain('nonexistent');
  });

  it('reports a null budget when the tenant has no budget row', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    expect((await usageSummary(db, church.id)).monthlyUsd).toBeNull();
  });
});
