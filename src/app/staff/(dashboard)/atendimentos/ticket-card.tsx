'use client';

import { useActionState } from 'react';
import { formatDateTime } from '@/core/format';
import {
  sendReply, suggestReply, updateTicketStatus, type SendReplyState, type SuggestReplyState,
} from './actions';

export type TicketRow = {
  id: string;
  topic: string;
  status: string;
  suggestedReply: string | null;
  createdAt: Date;
};

const STATUS_LABEL: Record<string, string> = { open: 'Aberto', answered: 'Respondido', closed: 'Encerrado' };

const SUGGEST_INITIAL: SuggestReplyState = {};
const SEND_INITIAL: SendReplyState = {};

// One row per ticket. Open tickets get the full "suggest -> edit -> send" flow; the AI's
// draft is clearly labeled and never sent on its own — only the "Enviar" button, submitting
// whatever text is currently in the textarea (edited or not), sends anything.
export function TicketCard({ ticket }: { ticket: TicketRow }) {
  const [suggestState, suggestAction, suggesting] = useActionState(suggestReply, SUGGEST_INITIAL);
  const [sendState, sendAction, sending] = useActionState(sendReply, SEND_INITIAL);

  // Prefer the reply from this session's latest suggestion; fall back to whatever the
  // ticket already has saved (from an earlier suggestion, possibly in a previous page load).
  const draft = suggestState.reply ?? ticket.suggestedReply ?? '';
  const sources = suggestState.sources ?? [];

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
        draft && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600">{draft}</p>
        )
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

          <form action={sendAction} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={ticket.id} />
            {draft && (
              <p className="text-xs font-medium text-amber-700">
                Rascunho da IA — revise antes de enviar
              </p>
            )}
            <textarea
              key={draft}
              name="reply"
              defaultValue={draft}
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

          <form action={updateTicketStatus}>
            <input type="hidden" name="id" value={ticket.id} />
            <input type="hidden" name="status" value="closed" />
            <button type="submit" className="self-start text-xs text-neutral-500 underline">
              Encerrar sem responder
            </button>
          </form>
        </div>
      )}
    </li>
  );
}
