import Link from 'next/link';
import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import { listDocuments } from '@/db/repo/documents';
import { listPrayerRequests } from '@/db/repo/prayer';
import { listTickets } from '@/db/repo/tickets';
import { usageSummary } from '@/db/repo/usage';

export const metadata = { title: 'Início — Secretaria' };

function Tile({
  href, label, value, hint,
}: {
  href: string; label: string; value: string; hint?: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-xl border p-4 transition-colors hover:border-emerald-600"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
      {hint && <span className="text-xs text-neutral-500">{hint}</span>}
    </Link>
  );
}

// The guard in `(dashboard)/layout.tsx` already ensures a valid staff session exists
// before this renders; `requireStaffContext()` here is what supplies `churchId` for every
// query below — never a form field or query parameter (see src/core/staff-context.ts).
export default async function StaffHome() {
  const { churchId, churchName } = await requireStaffContext();
  const db = getDb();

  const [tickets, newPrayerRequests, docs, usage] = await Promise.all([
    listTickets(db, churchId),
    listPrayerRequests(db, churchId, 'new'),
    listDocuments(db, churchId),
    usageSummary(db, churchId),
  ]);

  const openTickets = tickets.filter((t) => t.status === 'open').length;
  const publishedDocs = docs.filter((d) => d.ingestStatus === 'published').length;
  const failedDocs = docs.filter((d) => d.ingestStatus === 'failed').length;
  const capLabel = usage.monthlyUsd != null
    ? `de US$ ${usage.monthlyUsd.toFixed(2)} no mês`
    : 'sem limite configurado para esta igreja';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Início</h2>
        <p className="mt-1 text-sm text-neutral-600">{churchName} — visão geral da secretaria.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile href="/staff/atendimentos" label="Atendimentos abertos" value={String(openTickets)} />
        <Tile href="/staff/oracoes" label="Pedidos de oração novos" value={String(newPrayerRequests.length)} />
        <Tile
          href="/staff/documentos"
          label="Documentos publicados"
          value={String(publishedDocs)}
          hint={failedDocs > 0 ? `${failedDocs} com falha` : undefined}
        />
        <Tile
          href="/staff/agenda"
          label="Eventos na agenda"
          value="Ver agenda"
        />
        <Tile
          href="/staff/uso"
          label="Uso no mês"
          value={`US$ ${usage.totalUsd.toFixed(2)}`}
          hint={capLabel}
        />
      </div>
    </div>
  );
}
