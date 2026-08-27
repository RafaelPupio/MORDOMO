import { describe, expect, it } from 'vitest';
import { ensureConversation, getConversationByVisitor, listMessages, saveMessage } from '@/db/repo/chat';
import { getOrganizationBySlug } from '@/db/repo/organizations';
import { createEvent, listUpcomingEvents } from '@/db/repo/events';
import { createPrayerRequest, listPrayerRequests } from '@/db/repo/prayer';
import { createTicket, listTickets } from '@/db/repo/tickets';
import { organizations, conversations } from '@/db/schema';
import { createTestDb, seedOrganization } from '../helpers/db';

describe('repos', () => {
  it('finds a church by slug', async () => {
    const db = await createTestDb();
    await db.insert(organizations).values({ slug: 'demo', name: 'Igreja da Colina' });
    expect((await getOrganizationBySlug(db, 'demo'))?.name).toBe('Igreja da Colina');
    expect(await getOrganizationBySlug(db, 'nope')).toBeUndefined();
  });

  it('conversation is idempotent; messages come back in order', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const convId = crypto.randomUUID();
    await ensureConversation(db, { id: convId, organizationId: church.id, visitorKey: 'v1' });
    await ensureConversation(db, { id: convId, organizationId: church.id, visitorKey: 'v1' }); // no throw
    await saveMessage(db, { organizationId: church.id, conversationId: convId, role: 'user', parts: [{ type: 'text', text: 'oi' }] });
    await saveMessage(db, { organizationId: church.id, conversationId: convId, role: 'assistant', parts: [{ type: 'text', text: 'olá!' }] });
    const msgs = await listMessages(db, convId);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  // C1: getConversationByVisitor is what lets a returning visitor resume their own thread
  // (src/channels/web.ts's history route) — scoped to organizationId AND visitorKey, and picking
  // the most recently started conversation among however many a visitor might have (a visitor
  // who chatted before this fix existed, when the client minted a fresh conversationId on
  // every page load, could already have several).
  it('getConversationByVisitor resumes the most recent conversation, scoped to church AND visitor key', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db, 'A');
    const b = await seedOrganization(db, 'B');

    // Visitor v1 at church A has two conversations, older then newer — startedAt set
    // explicitly (rather than relying on two back-to-back defaultNow() inserts) so the
    // "most recent" tie-break under test is deterministic regardless of clock resolution.
    const older = crypto.randomUUID();
    await db.insert(conversations).values({
      id: older, organizationId: a.id, visitorKey: 'v1', startedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newer = crypto.randomUUID();
    await db.insert(conversations).values({
      id: newer, organizationId: a.id, visitorKey: 'v1', startedAt: new Date('2026-01-02T00:00:00Z'),
    });
    expect((await getConversationByVisitor(db, a.id, 'v1'))?.id).toBe(newer);

    // A different visitor key at the same church finds nothing of v1's.
    expect(await getConversationByVisitor(db, a.id, 'v2')).toBeUndefined();

    // The same visitor key at a DIFFERENT church finds nothing either — visitorKey alone is
    // not a unique identity across tenants.
    expect(await getConversationByVisitor(db, b.id, 'v1')).toBeUndefined();
  });

  it('lists only future, verified events for the tenant, soonest first', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db, 'A');
    const b = await seedOrganization(db, 'B');
    const now = new Date('2026-09-01T00:00:00Z');
    await createEvent(db, { organizationId: a.id, title: 'Passado', startsAt: new Date('2026-08-01T10:00:00Z'), verified: true });
    await createEvent(db, { organizationId: a.id, title: 'Culto', startsAt: new Date('2026-09-06T10:00:00Z'), verified: true });
    await createEvent(db, { organizationId: a.id, title: 'Retiro', startsAt: new Date('2026-10-10T08:00:00Z'), verified: true });
    await createEvent(db, { organizationId: b.id, title: 'De outra igreja', startsAt: new Date('2026-09-02T10:00:00Z'), verified: true });
    const list = await listUpcomingEvents(db, a.id, 10, now);
    expect(list.map((e) => e.title)).toEqual(['Culto', 'Retiro']);
  });

  // I4: `events.verified` was written by the verifier but never enforced at read time —
  // `listUpcomingEvents` returned every future event regardless, so the verifier's whole
  // guarantee had no read-time backing. `createEvent` defaults `verified` to the schema's
  // own default (`false`) when the caller doesn't say otherwise, so an unverified event
  // must never appear here.
  it('never returns an unverified event, even when it is otherwise a perfectly good future event', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const now = new Date('2026-09-01T00:00:00Z');
    await createEvent(db, { organizationId: church.id, title: 'Não verificado', startsAt: new Date('2026-09-10T10:00:00Z') });
    await createEvent(db, { organizationId: church.id, title: 'Verificado', startsAt: new Date('2026-09-11T10:00:00Z'), verified: true });
    const list = await listUpcomingEvents(db, church.id, 10, now);
    expect(list.map((e) => e.title)).toEqual(['Verificado']);
  });

  it('creates and lists prayer requests and tickets per tenant', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    await createPrayerRequest(db, { organizationId: church.id, request: 'Pela minha família' });
    expect((await listPrayerRequests(db, church.id))[0].status).toBe('new');
    const ticket = await createTicket(db, { organizationId: church.id, topic: 'Falar com o pastor' });
    expect(ticket.status).toBe('open');
    expect(await listTickets(db, church.id)).toHaveLength(1);
  });
});
