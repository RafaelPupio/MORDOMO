'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { formatDateTime } from '@/core/format';
import type { SentTicketReply } from '@/core/staff-operations';
import {
  sendReply, suggestReply, updateTicketStatus,
  type SendReplyState, type TicketStatusState,
} from './actions';
import type { SuggestReplyState } from './suggest-reply-state';

// A narrow, client-safe projection of a ticket row — see atendimentos/page.tsx for why
// `churchId`/`conversationId` are deliberately left out. `sentReply` is `null` for an `open`
// ticket (nothing to show yet) and always populated otherwise.
export type TicketRow = {
  id: string;
  topic: string;
  status: string;
  createdAt: Date;
  suggestedReply: string | null;
  sentReply: SentTicketReply | null;
};

const STATUS_LABEL: Record<string, string> = { open: 'Aberto', answered: 'Respondido', closed: 'Encerrado' };

const SUGGEST_INITIAL: SuggestReplyState = {};
const SEND_INITIAL: SendReplyState = {};
const STATUS_INITIAL: TicketStatusState = {};

// What was ACTUALLY sent for a non-open ticket (I3) — read from the conversation, not the
// AI draft column, and always labeled plainly, including the two cases where there is
// nothing to show rather than silently falling back to the draft.
function SentReplyPanel({ sentReply }: { sentReply: SentTicketReply }) {
  if (!sentReply.found) {
    const message = sentReply.reason === 'no-conversation'
      ? 'Este atendimento não tem uma conversa associada — nada foi enviado por aqui.'
      : 'Nenhuma resposta foi registrada nesta conversa.';
    return <p className="mt-2 text-sm italic text-neutral-500">{message}</p>;
  }
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-neutral-500">Resposta enviada</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-800">{sentReply.text}</p>
    </div>
  );
}

// One row per ticket. Open tickets get the full "suggest -> edit -> send" flow; the AI's
// draft is clearly labeled and never sent on its own — only the "Enviar" button, submitting
// whatever text is currently in the textarea (edited or not), sends anything.
export function TicketCard({ ticket }: { ticket: TicketRow }) {
  const [suggestState, suggestAction, suggesting] = useActionState(suggestReply, SUGGEST_INITIAL);
  const [sendState, sendAction, sending] = useActionState(sendReply, SEND_INITIAL);
  const [statusState, statusAction, statusPending] = useActionState(updateTicketStatus, STATUS_INITIAL);

  // Prefer the reply from this session's latest suggestion; fall back to whatever the
  // ticket already has saved (from an earlier suggestion, possibly in a previous page load).
  const draft = suggestState.reply ?? ticket.suggestedReply ?? '';
  const sources = suggestState.sources ?? [];

  // Controlled textarea, seeded from `draft`, that only follows a NEW draft while the
  // staff member hasn't started editing it (current value still equals the last draft they
  // were shown). Replaces the previous `key={draft}` remount trick, which discarded any
  // in-progress edit every time a suggestion re-ran — this preserves those edits instead,
  // while a genuinely fresh draft still appears on an untouched textarea.
  const [replyText, setReplyText] = useState(draft);
  const lastDraftRef = useRef(draft);
  useEffect(() => {
    if (draft !== lastDraftRef.current) {
      setReplyText((current) => (current === lastDraftRef.current ? draft : current));
      lastDraftRef.current = draft;
    }
  }, [draft]);

  const replyFieldId = `reply-${ticket.id}`;
  const draftWarningId = `draft-warning-${ticket.id}`;

  return (
    <li className="rounded-xl border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{ticket.topic}</h3>
        <div className="flex items-center gap-2">
          <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
            {STATUS_LABEL[ticket.status] ?? ticket.status}
          </span>
          <span className="text-xs text-neutral-500">{formatDateTime(ticket.createdAt)}</span>
        </div>
      </div>

      {ticket.status !== 'open' ? (
        ticket.sentReply && <SentReplyPanel sentReply={ticket.sentReply} />
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <form action={suggestAction}>
            <input type="hidden" name="id" value={ticket.id} />
            <button
              type="submit"
              disabled={suggesting}
              className="self-start rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {suggesting ? 'Gerando…' : 'Sugerir resposta'}
            </button>
          </form>
          {suggestState.error && <p role="alert" className="text-xs text-red-700">{suggestState.error}</p>}
          {suggestState.notice && <p role="status" className="text-xs text-amber-700">{suggestState.notice}</p>}

          <form action={sendAction} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={ticket.id} />
            {draft && (
              <p id={draftWarningId} className="text-xs font-medium text-amber-700">
                Rascunho da IA — revise antes de enviar
              </p>
            )}
            <label htmlFor={replyFieldId} className="text-xs font-medium text-neutral-700">
              Resposta
            </label>
            <textarea
              id={replyFieldId}
              name="reply"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              aria-describedby={draft ? draftWarningId : undefined}
              rows={3}
              placeholder="Escreva a resposta…"
              className="rounded-xl border px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />

            {sources.length > 0 && (
              <div className="rounded-lg bg-neutral-50 p-2 text-xs text-neutral-600">
                <p className="font-medium text-neutral-500">Fontes usadas na sugestão</p>
                <ul className="mt-1 list-disc pl-4">
                  {sources.map((s) => <li key={s.documentId}>{s.documentTitle}</li>)}
                </ul>
              </div>
            )}

            {sendState.error && <p role="alert" className="text-xs text-red-700">{sendState.error}</p>}
            {sendState.ok && <p role="status" className="text-xs text-emerald-700">{sendState.ok}</p>}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={sending}
                className="self-start rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {sending ? 'Enviando…' : 'Enviar'}
              </button>
            </div>
          </form>

          <form action={statusAction} className="flex flex-col items-start gap-1">
            <input type="hidden" name="id" value={ticket.id} />
            <input type="hidden" name="status" value="closed" />
            <button
              type="submit"
              disabled={statusPending}
              className="self-start text-xs text-neutral-500 underline disabled:opacity-50"
            >
              Encerrar sem responder
            </button>
            {statusState.error && <p role="alert" className="text-xs text-red-700">{statusState.error}</p>}
          </form>
        </div>
      )}
    </li>
  );
}
