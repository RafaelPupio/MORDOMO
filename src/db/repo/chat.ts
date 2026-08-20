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

// Fetches the conversation row as it actually exists in the database. Used to verify
// ownership after ensureConversation: onConflictDoNothing means the row that matters
// is whichever one was already there, not necessarily the one the caller intended to
// insert.
export async function getConversation(db: Db, id: string) {
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
  return row;
}

export async function saveMessage(
  db: Db,
  input: {
    churchId: string;
    conversationId: string;
    role: 'user' | 'assistant';
    parts: unknown;
    // I5: when present, makes this insert idempotent per (conversationId, clientMessageId)
    // — a second saveMessage call for the same client-authored turn (e.g. a retry resending
    // the same history) silently no-ops instead of inserting a duplicate row. Omitted for
    // assistant-authored messages, which have no client id and are never retried this way.
    clientMessageId?: string;
  },
): Promise<void> {
  await db
    .insert(messages)
    .values({ ...input, clientMessageId: input.clientMessageId ?? null })
    .onConflictDoNothing({ target: [messages.conversationId, messages.clientMessageId] });
}

export async function listMessages(db: Db, conversationId: string) {
  return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.seq));
}
