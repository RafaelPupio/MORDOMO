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

  it('lists only future, verified events for the tenant, soonest first', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const now = new Date('2026-09-01T00:00:00Z');
    await createEvent(db, { churchId: a.id, title: 'Passado', startsAt: new Date('2026-08-01T10:00:00Z'), verified: true });
    await createEvent(db, { churchId: a.id, title: 'Culto', startsAt: new Date('2026-09-06T10:00:00Z'), verified: true });
    await createEvent(db, { churchId: a.id, title: 'Retiro', startsAt: new Date('2026-10-10T08:00:00Z'), verified: true });
    await createEvent(db, { churchId: b.id, title: 'De outra igreja', startsAt: new Date('2026-09-02T10:00:00Z'), verified: true });
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
    const church = await seedChurch(db);
    const now = new Date('2026-09-01T00:00:00Z');
    await createEvent(db, { churchId: church.id, title: 'Não verificado', startsAt: new Date('2026-09-10T10:00:00Z') });
    await createEvent(db, { churchId: church.id, title: 'Verificado', startsAt: new Date('2026-09-11T10:00:00Z'), verified: true });
    const list = await listUpcomingEvents(db, church.id, 10, now);
    expect(list.map((e) => e.title)).toEqual(['Verificado']);
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
