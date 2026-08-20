import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import { usageSummary } from '@/db/repo/usage';

export const metadata = { title: 'Uso — Secretaria' };

// These amounts are fractions of a cent per call — two decimals would show "US$ 0.00"
// for almost every row and make the table look broken. Four decimals is the smallest
// precision that still shows a non-zero number for a single cheap model call.
function formatUsd4(value: number): string {
  return `US$ ${value.toFixed(4)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const FEATURE_INFO: Record<string, { label: string; description: string }> = {
  'chat.reply': {
    label: 'Resposta do chat',
    description: 'A resposta que a Secretária Virtual gera para uma mensagem de um visitante no site.',
  },
  'chat.retrieval': {
    label: 'Busca do chat',
    description: 'A busca na base de conhecimento que embasa essa resposta, antes do modelo escrever o texto.',
  },
  'ingest.embed': {
    label: 'Indexação de documento',
    description: 'A geração dos vetores usados na busca, feita uma vez para cada trecho de um documento enviado.',
  },
  'ingest.extract': {
    label: 'Extração de eventos',
    description: 'A leitura de um documento enviado em busca de possíveis eventos para a agenda.',
  },
  'ingest.verify': {
    label: 'Verificação de eventos',
    description: 'Uma segunda checagem, por um modelo separado, que confirma ou rejeita cada evento extraído antes de ele aparecer na agenda.',
  },
  'support.draft': {
    label: 'Rascunho de atendimento',
    description: 'O rascunho de resposta que a IA sugere para um atendimento — sempre revisado por um humano antes de enviar.',
  },
  'support.retrieval': {
    label: 'Busca de atendimento',
    description: 'A busca na base de conhecimento que embasa esse rascunho de resposta.',
  },
};

// The guard in `(dashboard)/layout.tsx` already ensures a valid staff session exists before
// this renders; `requireStaffContext()` here is what supplies `churchId` for the query below
// — never a form field or query parameter (see src/core/staff-context.ts).
export default async function UsoPage() {
  const { churchId } = await requireStaffContext();
  const usage = await usageSummary(getDb(), churchId);

  const hasCap = usage.monthlyUsd != null;
  const capUsd = usage.monthlyUsd ?? 0;
  const barFraction = hasCap && capUsd > 0 ? Math.min(1, usage.totalUsd / capUsd) : 0;
  const overCap = hasCap && usage.totalUsd >= capUsd;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Uso e custo</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Quanto a IA custou este mês, por funcionalidade. Os valores são frações de
          centavo por chamada, por isso aparecem com quatro casas decimais.
        </p>
      </div>

      <div className="rounded-xl border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-2xl font-semibold">{formatUsd4(usage.totalUsd)}</span>
          <span className="text-sm text-neutral-500">
            {hasCap ? `de ${formatUsd4(capUsd)} no mês` : 'sem limite configurado para esta igreja'}
          </span>
        </div>

        {hasCap && (
          <div className="mt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className={`h-full rounded-full ${overCap ? 'bg-red-600' : 'bg-emerald-600'}`}
                style={{ width: `${barFraction * 100}%` }}
              />
            </div>
            {overCap && (
              <p className="mt-2 text-xs text-red-700">
                O limite do mês foi atingido — novas chamadas de IA passam a ser recusadas
                até o próximo mês.
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold">Uso por funcionalidade</h3>
        {usage.byFeature.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">Nenhuma chamada de IA registrada este mês.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Funcionalidade</th>
                  <th className="px-3 py-2 font-medium">Chamadas</th>
                  <th className="px-3 py-2 font-medium">Custo</th>
                  <th className="px-3 py-2 font-medium">Participação</th>
                </tr>
              </thead>
              <tbody>
                {usage.byFeature.map((row) => (
                  <tr key={row.feature} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{FEATURE_INFO[row.feature]?.label ?? row.feature}</div>
                      <div className="text-xs text-neutral-500">{row.feature}</div>
                    </td>
                    <td className="px-3 py-2">{row.calls}</td>
                    <td className="px-3 py-2">{formatUsd4(row.costUsd)}</td>
                    <td className="px-3 py-2">
                      {usage.totalUsd > 0 ? formatPercent(row.costUsd / usage.totalUsd) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold">O que cada item significa</h3>
        <dl className="mt-2 flex flex-col gap-3">
          {Object.entries(FEATURE_INFO).map(([feature, info]) => (
            <div key={feature}>
              <dt className="text-sm font-medium">
                {info.label} <span className="font-normal text-neutral-500">({feature})</span>
              </dt>
              <dd className="text-sm text-neutral-600">{info.description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
