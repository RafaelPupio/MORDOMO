import { draftReply, type ReplyDrafterDeps } from '@/agent/reply-drafter';
import { isUuid } from '@/core/ids';
import { textFromParts } from '@/core/message-text';
import type { Source } from '@/core/retrieval';
import type { Db } from '@/db/client';
import { listMessages, saveMessage } from '@/db/repo/chat';
import { setPrayerStatus, type PrayerStatus } from '@/db/repo/prayer';
import { getTicket, saveSuggestedReply, setTicketStatus, type TicketStatus } from '@/db/repo/tickets';

// The glue between the staff area's Server Actions and the repos + the drafter. Every
// function here takes an explicit `organizationId` (never derives it) so it is testable without a
// request context, and every mutation is guarded by loading the target row scoped to
// `organizationId` FIRST — a form-supplied id for another church's row is a silent no-op, never a
// write. `requireStaffContext()` (src/core/staff-context.ts) is the only place `organizationId`
// is allowed to come from a real request; these functions just trust whatever they're given.
//
// Every id below also comes straight from untrusted `formData` upstream. Postgres rejects a
// non-UUID literal cast to a `uuid` column with a thrown DrizzleQueryError, so every function
// checks `isUuid` FIRST — before any query — and treats a malformed id exactly like "row not
// found for this church": a controlled no-op/empty result, never a throw.

/**
 * Moves a prayer request through its workflow. `setPrayerStatus` (src/db/repo/prayer.ts)
 * already scopes its UPDATE to `organizationId` in SQL, so a request belonging to another church
 * is a no-op there, not an error — this wrapper exists so oracoes/actions.ts has a plain,
 * unit-testable function to call instead of importing the repo directly.
 */
export async function applyPrayerStatus(
  db: Db,
  organizationId: string,
  id: string,
  status: PrayerStatus,
): Promise<void> {
  if (!isUuid(id)) return;
  await setPrayerStatus(db, organizationId, id, status);
}

/**
 * Flips a ticket's status directly (e.g. "Encerrar sem responder" — closed without ever
 * sending a reply). Mirrors `applyPrayerStatus`: `setTicketStatus` already scopes its UPDATE
 * to `organizationId`, this just adds the malformed-id guard and gives `atendimentos/actions.ts` a
 * plain, unit-testable function instead of importing the repo directly.
 */
export async function applyTicketStatus(
  db: Db,
  organizationId: string,
  id: string,
  status: TicketStatus,
): Promise<void> {
  if (!isUuid(id)) return;
  await setTicketStatus(db, organizationId, id, status);
}

export type SuggestTicketReplyInput = {
  organizationId: string;
  organizationName: string;
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

// A coarse, cheap pre-filter on message COUNT, checked before any per-message text extraction
// runs. It does NOT bound prompt SIZE — see MAX_EXCERPT_CHARS below for that — because
// `src/channels/web.ts` accepts (and persists) a single message up to MODEL_HISTORY_CHARS
// (24,000 characters): 20 of those would be up to ~480,000 characters, ~120,000 tokens, in one
// `support.draft` prompt, roughly 12x MODEL_HISTORY_CHARS itself and, at CHAT_MODEL pricing
// (src/ai/pricing.ts), on the order of $0.12 for a single suggestReply call.
const MAX_EXCERPT_MESSAGES = 20;

// The actual size bound. Mirrors `trimHistoryForModel` in src/channels/web.ts: walk the
// (already count-bounded) history from newest to oldest, keep adding whole lines while they
// still fit, then restore chronological order — the excerpt always ends at the most recent
// turn and is trimmed from the OLD end, never from the middle. Like `trimHistoryForModel`, the
// newest qualifying line is always kept even if it alone exceeds the budget (see
// `excerptFromMessages` below) — the most recent thing the visitor said is the least safe turn
// to drop from a reply draft. 8,000 characters is generous for a support-ticket excerpt while
// keeping the worst case (MAX_EXCERPT_MESSAGES x a message at MODEL_HISTORY_CHARS) from ever
// reaching the prompt at all.
const MAX_EXCERPT_CHARS = 8_000;

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
// Bounded twice: MAX_EXCERPT_MESSAGES first (cheap, count-only), then MAX_EXCERPT_CHARS here
// (the actual size bound) — see both constants' comments above for why count alone isn't
// enough.
function excerptFromMessages(history: { role: string; parts: unknown }[]): string | undefined {
  const recent = history.slice(-MAX_EXCERPT_MESSAGES);
  const kept: string[] = [];
  let total = 0;
  // Walk newest-first so truncation drops from the OLD end, never the new one.
  for (let i = recent.length - 1; i >= 0; i--) {
    const text = textFromParts(recent[i].parts).trim();
    if (!text) continue;
    const line = `${recent[i].role === 'user' ? 'Visitante' : 'Assistente'}: ${text}`;
    // +1 for the '\n' the final join() below adds between lines, so `total` tracks the
    // actual output length rather than silently under-counting it.
    const size = line.length + 1;
    // `kept.length > 0` guards keeping the FIRST (i.e. newest) line unconditionally, even if
    // it alone exceeds MAX_EXCERPT_CHARS — mirroring trimHistoryForModel's "always keep the
    // newest whole" rule in src/channels/web.ts.
    if (total + size > MAX_EXCERPT_CHARS && kept.length > 0) break;
    kept.push(line);
    total += size;
  }
  kept.reverse();
  return kept.length > 0 ? kept.join('\n') : undefined;
}

/**
 * Drafts (via `draftReply`) and persists a suggested reply for a ticket, editable and unsent
 * until a staff member sends it. Guards by loading the ticket scoped to `organizationId` first: a
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

  const ticket = await getTicket(deps.db, input.organizationId, input.ticketId);
  if (!ticket) return { reply: '', sources: [], generated: false };

  const conversationExcerpt = ticket.conversationId
    ? excerptFromMessages(await listMessages(deps.db, ticket.conversationId))
    : undefined;

  const draft = await draftReply(deps, {
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    ticketId: ticket.id,
    topic: ticket.topic,
    conversationExcerpt,
  });

  if (draft.reply.length > 0) {
    await saveSuggestedReply(deps.db, input.organizationId, ticket.id, draft.reply);
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
 * belonging to another church (loaded scoped to `organizationId` first, exactly like the guard in
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
  organizationId: string,
  ticketId: string,
  reply: string,
): Promise<SendTicketReplyResult> {
  const trimmed = reply.trim();
  if (!trimmed) return { sent: false, reason: 'empty' };
  if (!isUuid(ticketId)) return { sent: false, reason: 'invalid-id' };

  const ticket = await getTicket(db, organizationId, ticketId);
  if (!ticket) return { sent: false, reason: 'not-found' };
  if (ticket.status !== 'open') return { sent: false, reason: 'not-open' };

  if (ticket.conversationId) {
    await saveMessage(db, {
      organizationId,
      conversationId: ticket.conversationId,
      role: 'assistant',
      parts: [{ type: 'text', text: trimmed }],
    });
  }

  await setTicketStatus(db, organizationId, ticketId, 'answered');
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
  organizationId: string,
  ticketId: string,
): Promise<SentTicketReply> {
  if (!isUuid(ticketId)) return { found: false, reason: 'no-conversation' };

  const ticket = await getTicket(db, organizationId, ticketId);
  if (!ticket || !ticket.conversationId) return { found: false, reason: 'no-conversation' };

  const history = await listMessages(db, ticket.conversationId);
  const sent = history
    .filter((m) => m.role === 'assistant' && m.createdAt > ticket.createdAt && isPlainTextMessage(m.parts))
    .map((m) => textFromParts(m.parts).trim())
    .filter((text) => text.length > 0);

  if (sent.length === 0) return { found: false, reason: 'no-reply' };
  return { found: true, text: sent.join('\n\n') };
}
