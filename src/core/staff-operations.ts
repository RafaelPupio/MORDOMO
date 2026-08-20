import { draftReply, type ReplyDrafterDeps } from '@/agent/reply-drafter';
import type { Source } from '@/core/retrieval';
import type { Db } from '@/db/client';
import { listMessages, saveMessage } from '@/db/repo/chat';
import { setPrayerStatus, type PrayerStatus } from '@/db/repo/prayer';
import { getTicket, saveSuggestedReply, setTicketStatus } from '@/db/repo/tickets';

// The glue between the staff area's Server Actions and the repos + the drafter. Every
// function here takes an explicit `churchId` (never derives it) so it is testable without a
// request context, and every mutation is guarded by loading the target row scoped to
// `churchId` FIRST — a form-supplied id for another church's row is a silent no-op, never a
// write. `requireStaffContext()` (src/core/staff-context.ts) is the only place `churchId`
// is allowed to come from a real request; these functions just trust whatever they're given.

/**
 * Moves a prayer request through its workflow. `setPrayerStatus` (src/db/repo/prayer.ts)
 * already scopes its UPDATE to `churchId` in SQL, so a request belonging to another church
 * is a no-op there, not an error — this wrapper exists so oracoes/actions.ts has a plain,
 * unit-testable function to call instead of importing the repo directly.
 */
export async function applyPrayerStatus(
  db: Db,
  churchId: string,
  id: string,
  status: PrayerStatus,
): Promise<void> {
  await setPrayerStatus(db, churchId, id, status);
}

export type SuggestTicketReplyInput = {
  churchId: string;
  churchName: string;
  ticketId: string;
};

const MAX_EXCERPT_MESSAGES = 20;

// Pulls the text out of an AI SDK UIMessage `parts` array (src/db/schema.ts's `messages`
// table stores exactly this shape). Anything that isn't a `text` part (tool calls, etc.) is
// dropped — the drafter's prompt wants prose, not a transcript of tool plumbing.
function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p): p is { type: unknown; text?: unknown } => typeof p === 'object' && p !== null)
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join(' ');
}

// Turns a ticket's conversation history into a compact excerpt for the drafter's prompt, so
// the draft is grounded in what the visitor actually said — not just the one-line `topic`
// summary the secretary agent wrote when it opened the ticket (src/agent/secretary.ts).
// Bounded to the most recent messages so a very long conversation can't blow up prompt size.
function excerptFromMessages(history: { role: string; parts: unknown }[]): string | undefined {
  const lines: string[] = [];
  for (const m of history.slice(-MAX_EXCERPT_MESSAGES)) {
    const text = textFromParts(m.parts).trim();
    if (text) lines.push(`${m.role === 'user' ? 'Visitante' : 'Assistente'}: ${text}`);
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * Drafts (via `draftReply`) and persists a suggested reply for a ticket, editable and unsent
 * until a staff member sends it. Guards by loading the ticket scoped to `churchId` first: a
 * ticket id that doesn't belong to this church, or doesn't exist, returns an empty draft
 * without touching the database.
 *
 * `draftReply` returns an empty string when the model call fails (see reply-drafter.ts) —
 * that empty draft must never overwrite a good `suggestedReply` already saved on the ticket,
 * so a new draft is only persisted, and only returned, when it is non-empty. On failure this
 * falls back to whatever was already saved (or empty, if nothing was), so a flaky model call
 * never regresses what the staff member sees.
 */
export async function suggestTicketReply(
  deps: ReplyDrafterDeps,
  input: SuggestTicketReplyInput,
): Promise<{ reply: string; sources: Source[] }> {
  const ticket = await getTicket(deps.db, input.churchId, input.ticketId);
  if (!ticket) return { reply: '', sources: [] };

  const conversationExcerpt = ticket.conversationId
    ? excerptFromMessages(await listMessages(deps.db, ticket.conversationId))
    : undefined;

  const draft = await draftReply(deps, {
    churchId: input.churchId,
    churchName: input.churchName,
    ticketId: ticket.id,
    topic: ticket.topic,
    conversationExcerpt,
  });

  if (draft.reply.length > 0) {
    await saveSuggestedReply(deps.db, input.churchId, ticket.id, draft.reply);
    return draft;
  }

  return { reply: ticket.suggestedReply ?? '', sources: [] };
}

/**
 * Sends a staff-edited reply: persists it as an assistant message on the ticket's
 * conversation, then flips the ticket to `answered`. Refuses an empty (or whitespace-only)
 * reply outright — nothing is written and the ticket keeps its current status. Guards by
 * loading the ticket scoped to `churchId` first: a ticket belonging to another church is a
 * silent no-op, exactly like the guard in `suggestTicketReply`.
 *
 * A ticket opened from a channel that never attached a conversation (`conversationId` is
 * nullable — src/db/schema.ts) has nothing to append the reply to; that is not an error,
 * it just skips the message write and still marks the ticket answered.
 */
export async function sendTicketReply(
  db: Db,
  churchId: string,
  ticketId: string,
  reply: string,
): Promise<void> {
  const trimmed = reply.trim();
  if (!trimmed) return;

  const ticket = await getTicket(db, churchId, ticketId);
  if (!ticket) return;

  if (ticket.conversationId) {
    await saveMessage(db, {
      churchId,
      conversationId: ticket.conversationId,
      role: 'assistant',
      parts: [{ type: 'text', text: trimmed }],
    });
  }

  await setTicketStatus(db, churchId, ticketId, 'answered');
}
