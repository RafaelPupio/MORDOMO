import Link from 'next/link';
import { formatDateTime } from '@/core/format';
import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import { listPrayerRequests, type PrayerStatus } from '@/db/repo/prayer';
import { updatePrayerStatus } from './actions';

export const metadata = { title: 'Orações — Secretaria' };

const STATUS_LABEL: Record<PrayerStatus, string> = {
  new: 'Nova',
  praying: 'Orando',
  done: 'Concluída',
};

const STATUS_STYLE: Record<PrayerStatus, string> = {
  new: 'bg-sky-100 text-sky-800',
  praying: 'bg-amber-100 text-amber-800',
  done: 'bg-emerald-100 text-emerald-800',
};

const STATUS_ORDER: readonly PrayerStatus[] = ['new', 'praying', 'done'];

const FILTERS: { value?: PrayerStatus; label: string }[] = [
  { value: undefined, label: 'Todas' },
  { value: 'new', label: 'Novas' },
  { value: 'praying', label: 'Orando' },
  { value: 'done', label: 'Concluídas' },
];

function isPrayerStatus(value: string | undefined): value is PrayerStatus {
  return value === 'new' || value === 'praying' || value === 'done';
}

function StatusBadge({ status }: { status: string }) {
  const known = isPrayerStatus(status) ? status : undefined;
  const label = known ? STATUS_LABEL[known] : status;
  const style = known ? STATUS_STYLE[known] : 'bg-neutral-100 text-neutral-700';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}

// The guard in `(dashboard)/layout.tsx` already ensures a valid staff session exists before
// this renders; `requireStaffContext()` here is what supplies `churchId` for the query below
// — never a form field or query parameter (see src/core/staff-context.ts).
export default async function OracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { churchId } = await requireStaffContext();
  const { status: statusParam } = await searchParams;
  const status = isPrayerStatus(statusParam) ? statusParam : undefined;

  const requests = await listPrayerRequests(getDb(), churchId, status);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Pedidos de oração</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Pedidos enviados pelo assistente do site. Marque o andamento conforme a equipe
          ora por cada um.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            href={f.value ? `/staff/oracoes?status=${f.value}` : '/staff/oracoes'}
            className={`rounded-full border px-3 py-1 ${
              status === f.value ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'text-neutral-600'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {requests.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum pedido de oração aqui.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((req) => (
            <li key={req.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <StatusBadge status={req.status} />
                <span className="text-xs text-neutral-500">{formatDateTime(req.createdAt)}</span>
              </div>
              <p className="mt-2 text-sm text-neutral-800">{req.request}</p>
              {req.name && <p className="mt-1 text-xs text-neutral-500">— {req.name}</p>}

              <div className="mt-3 flex gap-2">
                {STATUS_ORDER.map((s) => (
                  <form key={s} action={updatePrayerStatus}>
                    <input type="hidden" name="id" value={req.id} />
                    <input type="hidden" name="status" value={s} />
                    <button
                      type="submit"
                      disabled={req.status === s}
                      className="rounded-lg border px-3 py-1 text-xs font-medium disabled:cursor-default disabled:opacity-40"
                    >
                      {STATUS_LABEL[s]}
                    </button>
                  </form>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
