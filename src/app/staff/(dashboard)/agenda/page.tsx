import Link from 'next/link';
import { formatDateTime } from '@/core/format';
import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import { listDocuments } from '@/db/repo/documents';
import { listUpcomingEvents } from '@/db/repo/events';

export const metadata = { title: 'Agenda — Secretaria' };

export default async function AgendaPage() {
  const { organizationId } = await requireStaffContext();
  const db = getDb();

  const [events, docs] = await Promise.all([
    listUpcomingEvents(db, organizationId, 50),
    listDocuments(db, organizationId),
  ]);
  const titleByDocumentId = new Map(docs.map((d) => [d.id, d.title]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Agenda</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Só eventos verificados aparecem aqui — cada um passou por um segundo modelo que
          checou a extração contra o documento de origem antes de ser publicado. A nota de
          verificação e o trecho citado abaixo são o registro desse processo.
        </p>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Nenhum evento verificado no horizonte. Envie um documento em{' '}
          <Link href="/staff/documentos" className="text-emerald-800 underline">Documentos</Link>{' '}
          para alimentar a agenda.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((event) => {
            const sourceTitle = event.sourceDocumentId
              ? titleByDocumentId.get(event.sourceDocumentId)
              : undefined;
            return (
              <li key={event.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">{event.title}</h3>
                  <span className="text-xs text-neutral-500">{formatDateTime(event.startsAt)}</span>
                </div>
                {event.location && (
                  <p className="mt-1 text-sm text-neutral-600">{event.location}</p>
                )}
                {event.description && (
                  <p className="mt-1 text-sm text-neutral-600">{event.description}</p>
                )}

                {(event.verificationNote || event.sourceQuote || sourceTitle) && (
                  <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
                    <p className="font-medium text-neutral-500">Como a IA confirmou isso</p>
                    {event.verificationNote && (
                      <p className="mt-1">{event.verificationNote}</p>
                    )}
                    {event.sourceQuote && (
                      <blockquote className="mt-1 border-l-2 border-neutral-300 pl-2 italic">
                        &ldquo;{event.sourceQuote}&rdquo;
                      </blockquote>
                    )}
                    {sourceTitle && (
                      <p className="mt-2">
                        Fonte:{' '}
                        <Link href="/staff/documentos" className="text-emerald-800 underline">
                          {sourceTitle}
                        </Link>
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
