import { draftReply, type ReplyDrafterDeps } from '@/agent/reply-drafter';
import { isUuid } from '@/core/ids';
import type { Source } from '@/core/retrieval';
import type { Db } from '@/db/client';
import { listMessages, saveMessage } from '@/db/repo/chat';
import { setPrayerStatus, type PrayerStatus } from '@/db/repo/prayer';
import { getTicket, saveSuggestedReply, setTicketStatus, type TicketStatus } from '@/db/repo/tickets';

// The glue between the staff area's Server Actions and the repos + the drafter. Every
// function here takes an explicit `churchId` (never derives it) so it is testable without a
// request context, and every mutation is guarded by loading the target row scoped to
// `churchId` FIRST — a form-supplied id for another church's row is a silent no-op, never a
// write. `requireStaffContext()` (src/core/staff-context.ts) is the only place `churchId`
// is allowed to come from a real request; these functions just trust whatever they're given.
//
// Every id below also comes straight from untrusted `formData` upstream. Postgres rejects a
// non-UUID literal cast to a `uuid` column with a thrown DrizzleQueryError, so every function
// checks `isUuid` FIRST — before any query — and treats a malformed id exactly like "row not
// found for this church": a controlled no-op/empty result, never a throw.

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
  if (!isUuid(id)) return;
  await setPrayerStatus(db, churchId, id, status);
}

/**
 * Flips a ticket's status directly (e.g. "Encerrar sem responder" — closed without ever
 * sending a reply). Mirrors `applyPrayerStatus`: `setTicketStatus` already scopes its UPDATE
 * to `churchId`, this just adds the malformed-id guard and gives `atendimentos/actions.ts` a
 * plain, unit-testable function instead of importing the repo directly.
 */
export async function applyTicketStatus(
  db: Db,
  churchId: string,
  id: string,
  status: TicketStatus,
): Promise<void> {
  if (!isUuid(id)) return;
  await setTicketStatus(db, churchId, id, status);
}

export type SuggestTicketReplyInput = {
  churchId: string;
  churchName: string;
  ticketId: string;
};

export type SuggestTicketReplyResult = {
  reply: string;
  sources: Source[];
  // True only when THIS call produced and persisted a fresh draft. False covers every
  // fallback path (drafter failed/returned empty, ticket not found, malformed id) — the
  // caller needs this to tell "here is a new suggestion" apart from "here is whatever was
  // already there," since `reply` alone can't: a stale fallback and a fresh draft can hold
  // the identical text.
  generated: boolean;
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

// True when every part of a message is a plain `text` part — i.e. nothing in it came from a
// tool call. Used by `getSentTicketReply` below to tell a staff-typed reply apart from the
// bot's own turns (see that function's doc comment for why this matters).
function isPlainTextMessage(parts: unknown): boolean {
  return (
    Array.isArray(parts) &&
    parts.length > 0 &&
    parts.every((p) => typeof p === 'object' && p !== null && (p as { type?: unknown }).type === 'text')
  );
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
 * ticket id that doesn't belong to this church, or doesn't exist, or isn't even shaped like a
 * uuid, returns an empty, ungenerated result without touching the database.
 *
 * `draftReply` returns an empty string when the model call fails (see reply-drafter.ts) —
 * that empty draft must never overwrite a good `suggestedReply` already saved on the ticket,
 * so a new draft is only persisted, and only reported as `generated: true`, when it is
 * non-empty. On failure this falls back to whatever was already saved (or empty, if nothing
 * was), so a flaky model call never regresses what the staff member sees — but the caller can
 * now tell, via `generated`, that this fallback happened and surface that plainly instead of
 * silently presenting stale text as if it were fresh.
 */
export async function suggestTicketReply(
  deps: ReplyDrafterDeps,
  input: SuggestTicketReplyInput,
): Promise<SuggestTicketReplyResult> {
  if (!isUuid(input.ticketId)) return { reply: '', sources: [], generated: false };

  const ticket = await getTicket(deps.db, input.churchId, input.ticketId);
  if (!ticket) return { reply: '', sources: [], generated: false };

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
    return { ...draft, generated: true };
  }

  return { reply: ticket.suggestedReply ?? '', sources: [], generated: false };
}

export type SendTicketReplyResult =
  | { sent: true }
  | { sent: false; reason: 'empty' | 'invalid-id' | 'not-found' | 'not-open' };

/**
 * Sends a staff-edited reply: persists it as an assistant message on the ticket's
 * conversation, then flips the ticket to `answered`. Refuses an empty (or whitespace-only)
 * reply outright (nothing written), a malformed/non-uuid id (nothing queried), and a ticket
 * belonging to another church (loaded scoped to `churchId` first, exactly like the guard in
 * `suggestTicketReply` — nothing written, status unchanged).
 *
 * Also refuses to send on a ticket that isn't currently `open`. This is deliberate, not
 * just defensive: without it, two submits of the same "Enviar" form (a double-click, a
 * network retry) would append two identical assistant messages, and sending to an already
 * `closed` ticket would silently reopen it as `answered`. Requiring `open` makes both of
 * those a safe, explicit no-op instead.
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
): Promise<SendTicketReplyResult> {
  const trimmed = reply.trim();
  if (!trimmed) return { sent: false, reason: 'empty' };
  if (!isUuid(ticketId)) return { sent: false, reason: 'invalid-id' };

  const ticket = await getTicket(db, churchId, ticketId);
  if (!ticket) return { sent: false, reason: 'not-found' };
  if (ticket.status !== 'open') return { sent: false, reason: 'not-open' };

  if (ticket.conversationId) {
    await saveMessage(db, {
      churchId,
      conversationId: ticket.conversationId,
      role: 'assistant',
      parts: [{ type: 'text', text: trimmed }],
    });
  }

  await setTicketStatus(db, churchId, ticketId, 'answered');
  return { sent: true };
}

export type SentTicketReply =
  | { found: true; text: string }
  | { found: false; reason: 'no-conversation' | 'no-reply' };

/**
 * Recovers what staff ACTUALLY sent for a ticket, by reading the conversation it's attached
 * to — never `ticket.suggestedReply`, which is the AI draft column: staff edits before
 * sending go straight to `messages` (see `sendTicketReply` above) and are never written back
 * to `suggestedReply`, so that column can disagree with what was actually sent, or still hold
 * a draft nobody ever sent at all.
 *
 * No schema addition exists to mark "this message was staff-sent" directly, so this derives
 * it from what's already there: `sendTicketReply` is the ticket flow's only writer of
 * assistant messages, it always writes a single plain-text part, and it only ever runs after
 * the ticket itself already exists. Filtering the conversation's assistant messages down to
 * "text-only" AND "created after the ticket" excludes both everything from before escalation
 * and the bot's own escalation-turn reply (which necessarily carries a tool-call part for the
 * very `escalateToHuman` invocation that opened this ticket). This is a heuristic, not a
 * guarantee — a visitor who keeps chatting with the bot after the ticket opens, on a turn
 * where it happens not to call any tool, would be picked up here too — but it's the closest
 * derivation available from existing data without a schema change.
 */
export async function getSentTicketReply(
  db: Db,
  churchId: string,
  ticketId: string,
): Promise<SentTicketReply> {
  const ticket = await getTicket(db, churchId, ticketId);
  if (!ticket || !ticket.conversationId) return { found: false, reason: 'no-conversation' };

  const history = await listMessages(db, ticket.conversationId);
  const sent = history
    .filter((m) => m.role === 'assistant' && m.createdAt > ticket.createdAt && isPlainTextMessage(m.parts))
    .map((m) => textFromParts(m.parts).trim())
    .filter((text) => text.length > 0);

  if (sent.length === 0) return { found: false, reason: 'no-reply' };
  return { found: true, text: sent.join('\n\n') };
}
