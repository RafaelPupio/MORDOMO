import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { tickets } from '@/db/schema';

export type TicketStatus = 'open' | 'answered' | 'closed';

export async function createTicket(db: Db, input: { organizationId: string; conversationId?: string; topic: string }) {
  const [row] = await db.insert(tickets).values(input).returning();
  return row;
}

export async function getTicket(db: Db, organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, id)));
  return row;
}

export async function listTickets(db: Db, organizationId: string) {
  return db.select().from(tickets).where(eq(tickets.organizationId, organizationId)).orderBy(desc(tickets.createdAt));
}

export async function setTicketStatus(
  db: Db,
  organizationId: string,
  id: string,
  status: TicketStatus,
): Promise<void> {
  await db
    .update(tickets)
    .set({ status })
    .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, id)));
}

export async function saveSuggestedReply(
  db: Db,
  organizationId: string,
  id: string,
  reply: string,
): Promise<void> {
  await db
    .update(tickets)
    .set({ suggestedReply: reply })
    .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, id)));
}
