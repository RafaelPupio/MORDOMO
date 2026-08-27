import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { conversations, messages } from '@/db/schema';

export async function ensureConversation(
  db: Db,
  input: { id: string; organizationId: string; visitorKey: string; channel?: string },
): Promise<void> {
  await db
    .insert(conversations)
    .values({ id: input.id, organizationId: input.organizationId, visitorKey: input.visitorKey, channel: input.channel ?? 'web' })
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

// Lets a returning visitor resume their own thread without a second cookie: `visitorKey` is
// already the sole ownership authority `getConversation`'s caller (src/channels/web.ts) checks
// against, so deriving "which conversation is this visitor's" from the same column, instead of
// minting and trusting a separate `conversationId` cookie, means there is exactly one place
// ownership can ever disagree with itself, not two that could drift apart. Scoped to `organizationId`
// too, since `visitorKey` alone is not guaranteed unique across tenants. `desc(startedAt)` picks
// the most recently started conversation — before this history route existed, the client minted
// a fresh `conversationId` on every page load, so a visitor who has been chatting since before
// this fix may already have several rows under the same `visitorKey`; resuming the newest one is
// the only sensible choice among them.
export async function getConversationByVisitor(db: Db, organizationId: string, visitorKey: string) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.visitorKey, visitorKey)))
    .orderBy(desc(conversations.startedAt))
    .limit(1);
  return row;
}

export async function saveMessage(
  db: Db,
  input: {
    organizationId: string;
    conversationId: string;
    role: 'user' | 'assistant';
    parts: unknown;
    // When present, makes this insert idempotent per (conversationId, clientMessageId) — a
    // second saveMessage call for the same client-authored turn (e.g. a retry resending
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
