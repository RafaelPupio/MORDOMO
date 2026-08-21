import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import { listReports } from '@/db/repo/reports';
import { FindingsSummary } from './findings-summary';
import { GenerateReportButton } from './generate-button';
import { formatPeriodLabel } from './period';
import { ReportBody } from './report-body';

export const metadata = { title: 'Relatórios — Secretaria' };

// The guard in `(dashboard)/layout.tsx` already ensures a valid staff session exists before
// this renders; `requireStaffContext()` here is what supplies `churchId` for the query below
// — never a form field or query parameter (see src/core/staff-context.ts).
export default async function RelatoriosPage() {
  const { churchId } = await requireStaffContext();
  const reports = await listReports(getDb(), churchId, 12);
  const [latest, ...older] = reports;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Relatórios</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Um resumo semanal da atividade da igreja, escrito por IA a partir de dados reais —
          um agente analisa a semana e produz achados estruturados, outro os transforma em
          texto. Gerado automaticamente toda segunda-feira, ou sob demanda abaixo.
        </p>
      </div>

      <GenerateReportButton />

      {!latest ? (
        <p className="text-sm text-neutral-500">
          Nenhum relatório ainda. Relatórios são gerados automaticamente toda segunda-feira a
          partir da atividade da semana anterior — use &quot;Gerar agora&quot; acima para criar
          o primeiro sem esperar.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Semana de {formatPeriodLabel(latest.periodStart, latest.periodEnd)}
            </p>
            <div className="mt-3">
              <ReportBody markdown={latest.body} />
            </div>
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-neutral-500">Como a IA chegou nisso</p>
              <FindingsSummary findings={latest.findings} />
            </div>
          </div>

          {older.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-neutral-700">Relatórios anteriores</h3>
              <ul className="mt-2 flex flex-col gap-3">
                {older.map((report) => (
                  <li key={report.id} className="rounded-xl border p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                      Semana de {formatPeriodLabel(report.periodStart, report.periodEnd)}
                    </p>
                    <div className="mt-3">
                      <ReportBody markdown={report.body} />
                    </div>
                    <div className="mt-4">
                      <p className="mb-2 text-xs font-medium text-neutral-500">Como a IA chegou nisso</p>
                      <FindingsSummary findings={report.findings} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
