import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import { listTickets } from '@/db/repo/tickets';
import { TicketCard } from './ticket-card';

export const metadata = { title: 'Atendimentos — Secretaria' };

// The guard in `(dashboard)/layout.tsx` already ensures a valid staff session exists before
// this renders; `requireStaffContext()` here is what supplies `churchId` for the query below
// — never a form field or query parameter (see src/core/staff-context.ts).
export default async function AtendimentosPage() {
  const { churchId } = await requireStaffContext();
  const tickets = await listTickets(getDb(), churchId);

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

      {tickets.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum atendimento por aqui.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />)}
        </ul>
      )}
    </div>
  );
}
