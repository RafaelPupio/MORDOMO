import { getSentTicketReply } from '@/core/staff-operations';
import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import { listTickets } from '@/db/repo/tickets';
import { TicketCard, type TicketRow } from './ticket-card';

export const metadata = { title: 'Atendimentos — Secretaria' };

// The guard in `(dashboard)/layout.tsx` already ensures a valid staff session exists before
// this renders; `requireStaffContext()` here is what supplies `churchId` for the query below
// — never a form field or query parameter (see src/core/staff-context.ts).
export default async function AtendimentosPage() {
  const { churchId } = await requireStaffContext();
  const db = getDb();
  const tickets = await listTickets(db, churchId);

  // Project a narrow, client-safe row per ticket instead of passing the full DB row to the
  // client component: `churchId`/`conversationId` never need to reach the browser (this is
  // same-tenant data, not a cross-church leak — just unnecessary payload in the RSC stream).
  // For a ticket that has left `open`, resolve here what was ACTUALLY sent (read from its
  // conversation, not the `suggestedReply` draft column — see `getSentTicketReply`'s doc
  // comment) so `TicketCard` never needs its own DB access.
  const rows: TicketRow[] = await Promise.all(
    tickets.map(async (ticket) => ({
      id: ticket.id,
      topic: ticket.topic,
      status: ticket.status,
      createdAt: ticket.createdAt,
      suggestedReply: ticket.suggestedReply,
      sentReply: ticket.status === 'open' ? null : await getSentTicketReply(db, churchId, ticket.id),
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Atendimentos</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Perguntas que o assistente do site não conseguiu responder sozinho. Peça uma
          sugestão de resposta à IA, revise o texto e só então envie — nada sai sem a sua
          leitura.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum atendimento por aqui.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => <TicketCard key={row.id} ticket={row} />)}
        </ul>
      )}
    </div>
  );
}
