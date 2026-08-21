'use server';

import { revalidatePath } from 'next/cache';
import { GatewayEmbedder } from '@/ai/embedder';
import { checkBudget } from '@/ai/usage';
import { parseGlobalCapUsd } from '@/core/config';
import { isUuid } from '@/core/ids';
import { checkRateLimit } from '@/core/rate-limit';
import { requireStaffContext } from '@/core/staff-context';
import { applyTicketStatus, sendTicketReply, suggestTicketReply } from '@/core/staff-operations';
import { getDb } from '@/db/client';
import type { TicketStatus } from '@/db/repo/tickets';
import { buildSuggestReplyState, type SuggestReplyState } from './suggest-reply-state';

const STAFF_SUGGEST_LIMIT = { limit: 30, windowSeconds: 3600 };
const VALID_STATUSES: readonly TicketStatus[] = ['open', 'answered', 'closed'];

function isTicketStatus(value: string): value is TicketStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

// `SuggestReplyState` itself is defined and exported from `./suggest-reply-state` (a plain
// module, not `'use server'`) — see that file's comment for why. Not re-exported from here:
// a `'use server'` file may only export async Server Actions, and while a type-only
// re-export is erased before bundling, importing the type directly from its own module
// avoids relying on that being true.
export type SendReplyState = { ok?: string; error?: string };
export type TicketStatusState = { error?: string };

/**
 * Drafts a suggested reply for a ticket and persists it — never sent automatically. Every
 * call is rate-limited and budget-gated the same way `documentos/actions.ts`'s upload does,
 * since it spends metered LLM/embedding calls (`suggestTicketReply` -> `draftReply`).
 * `churchId`/`churchName` come ONLY from `requireStaffContext()`; the ticket id in
 * `formData` is untrusted and validated as a uuid before it ever reaches a query — a
 * malformed id, or one for another church's row, is refused/returns empty the same way (the
 * operations-layer guard in `suggestTicketReply`, src/core/staff-operations.ts, loads the
 * ticket scoped to `churchId` first).
 *
 * The body is wrapped in try/catch — same posture as `documentos/actions.ts`'s upload — so a
 * DB outage or Neon cold start returns the Portuguese error shape instead of an uncaught
 * rejection reaching the client as a Next.js error digest (I1).
 */
export async function suggestReply(prevState: SuggestReplyState, formData: FormData): Promise<SuggestReplyState> {
  const { churchId, churchName } = await requireStaffContext();
  const ticketId = String(formData.get('id') ?? '');
  if (!isUuid(ticketId)) return { error: 'Atendimento inválido.' };

  const db = getDb();

  try {
    const rate = await checkRateLimit(db, `staff-suggest:${churchId}`, STAFF_SUGGEST_LIMIT);
    if (!rate.allowed) return { error: 'Muitas sugestões nesta hora. Tente novamente mais tarde.' };

    // parseGlobalCapUsd already falls back to its own default when the env var is unset — the
    // `?? String(DEFAULT_GLOBAL_CAP_USD)` this used to carry was a redundant second default
    // (M9); the API routes pass the raw env var through the same way.
    const budget = await checkBudget(db, churchId, parseGlobalCapUsd(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP));
    if (!budget.allowed) return { error: 'O limite de uso do mês foi atingido.' };

    const result = await suggestTicketReply(
      { db, embedder: new GatewayEmbedder() },
      { churchId, churchName, ticketId },
    );

    revalidatePath('/staff/atendimentos');
    return buildSuggestReplyState(prevState, result);
  } catch (error) {
    console.error('suggestReply: unexpected failure', { churchId, ticketId, error });
    return { error: 'Não foi possível gerar uma sugestão agora. Tente novamente mais tarde.' };
  }
}

/**
 * Sends the staff-edited reply: persists it into the ticket's conversation and marks the
 * ticket answered. `churchId` comes ONLY from `requireStaffContext()` — a form-crafted
 * ticket id for another church, or one that isn't shaped like a uuid, is refused by
 * `sendTicketReply`'s own guard (nothing written, status unchanged); so is a resend on a
 * ticket that has already left `open` (see that function's doc comment).
 *
 * Wrapped in try/catch for the same reason as `suggestReply` above (I1).
 */
export async function sendReply(_prevState: SendReplyState, formData: FormData): Promise<SendReplyState> {
  const { churchId } = await requireStaffContext();
  const ticketId = String(formData.get('id') ?? '');
  const reply = String(formData.get('reply') ?? '');
  if (!isUuid(ticketId)) return { error: 'Atendimento inválido.' };
  if (!reply.trim()) return { error: 'Escreva uma resposta antes de enviar.' };

  try {
    const result = await sendTicketReply(getDb(), churchId, ticketId, reply);
    revalidatePath('/staff/atendimentos');

    if (!result.sent) {
      if (result.reason === 'not-open') return { error: 'Este atendimento já foi respondido ou encerrado.' };
      return { error: 'Não foi possível enviar a resposta agora. Tente novamente.' };
    }
    // Nothing is PUSHED to the visitor here — no email, no WhatsApp, nothing that reaches
    // them if they've closed the tab. The reply is appended to the conversation's own
    // `messages` row (`sendTicketReply`, src/core/staff-operations.ts) in the same shape the
    // secretary agent's own replies use, and GET /api/chat/history (src/channels/web.ts)
    // serves that row back to the visitor's OWN cookie-identified conversation — so it
    // genuinely appears in their chat transcript the next time they open `/chat`, it just
    // doesn't summon them there.
    return { ok: 'Resposta registrada na conversa.' };
  } catch (error) {
    console.error('sendReply: unexpected failure', { churchId, ticketId, error });
    return { error: 'Não foi possível enviar a resposta agora. Tente novamente.' };
  }
}

/** Lets staff close a ticket directly (e.g. resolved outside the chat) without sending a reply. */
export async function updateTicketStatus(
  _prevState: TicketStatusState,
  formData: FormData,
): Promise<TicketStatusState> {
  const { churchId } = await requireStaffContext();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!isUuid(id)) return { error: 'Atendimento inválido.' };
  if (!isTicketStatus(status)) return { error: 'Status inválido.' };

  try {
    await applyTicketStatus(getDb(), churchId, id, status);
    revalidatePath('/staff/atendimentos');
    return {};
  } catch (error) {
    console.error('updateTicketStatus: unexpected failure', { churchId, id, status, error });
    return { error: 'Não foi possível atualizar o atendimento agora. Tente novamente.' };
  }
}
