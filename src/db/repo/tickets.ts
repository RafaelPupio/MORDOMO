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
