import type { IngestStatus } from '@/core/ingest-status';
import { formatDateTime } from '@/core/format';
import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import { listDocuments } from '@/db/repo/documents';
import { UploadForm } from './upload-form';

export const metadata = { title: 'Documentos — Secretaria' };

const STATUS_LABEL: Record<IngestStatus, string> = {
  uploaded: 'Enviado',
  parsing: 'Lendo',
  extracting: 'Extraindo',
  verifying: 'Verificando',
  published: 'Publicado',
  failed: 'Falhou',
};

const STATUS_STYLE: Record<IngestStatus, string> = {
  uploaded: 'bg-neutral-100 text-neutral-700',
  parsing: 'bg-sky-100 text-sky-800',
  extracting: 'bg-sky-100 text-sky-800',
  verifying: 'bg-amber-100 text-amber-800',
  published: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
};

function StatusBadge({ status }: { status: string }) {
  const known = status as IngestStatus;
  const label = STATUS_LABEL[known] ?? status;
  const style = STATUS_STYLE[known] ?? 'bg-neutral-100 text-neutral-700';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}

export default async function DocumentsPage() {
  const { organizationId } = await requireStaffContext();
  const docs = await listDocuments(getDb(), organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Documentos</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Envie boletins, escalas e comunicados. Cada arquivo passa pelo mesmo pipeline:
          leitura, indexação para busca e extração de eventos verificados para a agenda.
        </p>
      </div>

      <UploadForm />

      <div>
        <h3 className="text-sm font-semibold text-neutral-700">Base de conhecimento</h3>
        {docs.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">
            Nenhum documento enviado ainda. Use o formulário acima para começar.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Título</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Enviado em</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {docs.map((doc) => (
                  <tr key={doc.id}>
                    <td className="px-3 py-2 font-medium">{doc.title}</td>
                    <td className="px-3 py-2 text-neutral-600">{doc.kind}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={doc.ingestStatus} />
                      {doc.ingestStatus === 'failed' && doc.ingestError && (
                        <p className="mt-1 max-w-xs text-xs text-red-700">{doc.ingestError}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-neutral-500">
                      {formatDateTime(doc.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
