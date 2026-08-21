import Link from 'next/link';
import { formatUsd4 } from '@/core/format';
import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import { listDocuments } from '@/db/repo/documents';
import { listUpcomingEvents } from '@/db/repo/events';
import { listPrayerRequests } from '@/db/repo/prayer';
import { listReports } from '@/db/repo/reports';
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

  const [tickets, newPrayerRequests, docs, usage, upcomingEvents, reports] = await Promise.all([
    listTickets(db, churchId),
    listPrayerRequests(db, churchId, 'new'),
    listDocuments(db, churchId),
    usageSummary(db, churchId),
    // Same query and limit the agenda page itself uses (src/app/staff/(dashboard)/agenda/
    // page.tsx) — this tile's count is exactly what clicking through to Agenda shows, not a
    // separate figure that could disagree with it.
    listUpcomingEvents(db, churchId, 50),
    // Same limit the relatórios page itself uses (src/app/staff/(dashboard)/relatorios/
    // page.tsx) — this tile's count can never claim more reports exist than that page
    // actually lists.
    listReports(db, churchId, 12),
  ]);

  const openTickets = tickets.filter((t) => t.status === 'open').length;
  const publishedDocs = docs.filter((d) => d.ingestStatus === 'published').length;
  const failedDocs = docs.filter((d) => d.ingestStatus === 'failed').length;
  // formatUsd4 (src/core/format.ts), not a locally re-derived `.toFixed(2)` — this total is
  // the same `usage.totalUsd` /staff/uso shows, and the two used to disagree on precision
  // (M7).
  const capLabel = usage.monthlyUsd != null
    ? `de ${formatUsd4(usage.monthlyUsd)} no mês`
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
          value={String(upcomingEvents.length)}
        />
        <Tile
          href="/staff/relatorios"
          label="Relatórios semanais"
          value={String(reports.length)}
          hint={reports.length === 0 ? 'nenhum ainda' : undefined}
        />
        <Tile
          href="/staff/uso"
          label="Uso no mês"
          value={formatUsd4(usage.totalUsd)}
          hint={capLabel}
        />
      </div>
    </div>
  );
}
