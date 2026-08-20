'use server';

import { revalidatePath } from 'next/cache';
import { GatewayEmbedder } from '@/ai/embedder';
import { checkBudget } from '@/ai/usage';
import { DEFAULT_GLOBAL_CAP_USD, parseGlobalCapUsd } from '@/core/config';
import { checkRateLimit } from '@/core/rate-limit';
import type { Source } from '@/core/retrieval';
import { requireStaffContext } from '@/core/staff-context';
import { sendTicketReply, suggestTicketReply } from '@/core/staff-operations';
import { getDb } from '@/db/client';
import { setTicketStatus, type TicketStatus } from '@/db/repo/tickets';

const STAFF_SUGGEST_LIMIT = { limit: 30, windowSeconds: 3600 };
const VALID_STATUSES: readonly TicketStatus[] = ['open', 'answered', 'closed'];

function isTicketStatus(value: string): value is TicketStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

export type SuggestReplyState = { reply?: string; sources?: Source[]; error?: string };
export type SendReplyState = { ok?: string; error?: string };

/**
 * Drafts a suggested reply for a ticket and persists it — never sent automatically. Every
 * call is rate-limited and budget-gated the same way `documentos/actions.ts`'s upload does,
 * since it spends metered LLM/embedding calls (`suggestTicketReply` -> `draftReply`).
 * `churchId`/`churchName` come ONLY from `requireStaffContext()`; the ticket id in
 * `formData` is untrusted and can never reach another church's row — the operations-layer
 * guard in `suggestTicketReply` (src/core/staff-operations.ts) loads the ticket scoped to
 * `churchId` first and returns an empty draft when it doesn't belong to this church.
 */
export async function suggestReply(_prev: SuggestReplyState, formData: FormData): Promise<SuggestReplyState> {
  const { churchId, churchName } = await requireStaffContext();
  const ticketId = String(formData.get('id') ?? '');
  if (!ticketId) return { error: 'Atendimento inválido.' };

  const db = getDb();

  const rate = await checkRateLimit(db, `staff-suggest:${churchId}`, STAFF_SUGGEST_LIMIT);
  if (!rate.allowed) return { error: 'Muitas sugestões nesta hora. Tente novamente mais tarde.' };

  const budget = await checkBudget(
    db, churchId, parseGlobalCapUsd(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP ?? String(DEFAULT_GLOBAL_CAP_USD)),
  );
  if (!budget.allowed) return { error: 'O limite de uso do mês foi atingido.' };

  const draft = await suggestTicketReply(
    { db, embedder: new GatewayEmbedder() },
    { churchId, churchName, ticketId },
  );

  revalidatePath('/staff/atendimentos');

  if (!draft.reply) {
    return { error: 'Não foi possível gerar uma sugestão agora. Escreva a resposta manualmente abaixo.' };
  }
  return { reply: draft.reply, sources: draft.sources };
}

/**
 * Sends the staff-edited reply: persists it into the ticket's conversation and marks the
 * ticket answered. `churchId` comes ONLY from `requireStaffContext()` — a form-crafted
 * ticket id for another church is refused by `sendTicketReply`'s own guard (nothing written,
 * status unchanged).
 */
export async function sendReply(_prev: SendReplyState, formData: FormData): Promise<SendReplyState> {
  const { churchId } = await requireStaffContext();
  const ticketId = String(formData.get('id') ?? '');
  const reply = String(formData.get('reply') ?? '');
  if (!ticketId) return { error: 'Atendimento inválido.' };
  if (!reply.trim()) return { error: 'Escreva uma resposta antes de enviar.' };

  await sendTicketReply(getDb(), churchId, ticketId, reply);
  revalidatePath('/staff/atendimentos');
  return { ok: 'Resposta enviada.' };
}

/** Lets staff close a ticket directly (e.g. resolved outside the chat) without sending a reply. */
export async function updateTicketStatus(formData: FormData): Promise<void> {
  const { churchId } = await requireStaffContext();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !isTicketStatus(status)) return;

  await setTicketStatus(getDb(), churchId, id, status);
  revalidatePath('/staff/atendimentos');
}
