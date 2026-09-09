import { monthSpendUsd } from '@/ai/usage';
import { parseGlobalCapUsd } from '@/core/config';
import { parseRetentionDays, previewRetention, RETENTION_MIN_DAYS, type RetentionResult } from '@/core/retention';
import { formatUsd4 } from '@/core/format';
import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import { usageSummary } from '@/db/repo/usage';

export const metadata = { title: 'Uso — Secretaria' };

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

// One cap-vs-spend card, reused for both the tenant cap and the global cap below (M6) so the
// two read identically instead of the global one being an afterthought bolted onto the
// tenant card's markup.
function UsageCapCard({
  title, spentUsd, capUsd, overCapMessage,
}: {
  title: string;
  spentUsd: number;
  capUsd: number | null;
  overCapMessage: string;
}) {
  const hasCap = capUsd != null;
  const cap = capUsd ?? 0;
  const barFraction = hasCap && cap > 0 ? Math.min(1, spentUsd / cap) : 0;
  const overCap = hasCap && spentUsd >= cap;

  return (
    <div className="rounded-xl border p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{title}</span>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-2xl font-semibold">{formatUsd4(spentUsd)}</span>
        <span className="text-sm text-neutral-500">
          {hasCap ? `de ${formatUsd4(cap)} no mês` : 'sem limite configurado'}
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
          {overCap && <p className="mt-2 text-xs text-red-700">{overCapMessage}</p>}
        </div>
      )}
    </div>
  );
}

// The guard in `(dashboard)/layout.tsx` already ensures a valid staff session exists before
// this renders; `requireStaffContext()` here is what supplies `organizationId` for the tenant query
// below — never a form field or query parameter (see src/core/staff-context.ts).
export default async function UsoPage() {
  const { organizationId } = await requireStaffContext();
  const db = getDb();

  // Two independent gates, per src/ai/usage.ts's `checkBudget`: a per-tenant monthly cap
  // AND a global cap shared across every church in this demo. Before this fix, the page only
  // showed the tenant figure — with a low `DEMO_GLOBAL_MONTHLY_USD_CAP`, that meant a green,
  // nowhere-near-full bar here while every AI call was actually being refused with 402/
  // `budget_exhausted` for reasons this page gave staff no way to see (M6). `monthSpendUsd(db)`
  // with no `organizationId` is the same aggregate-across-every-tenant query `checkBudget` itself
  // runs for the global check.
  const retentionDays = parseRetentionDays(process.env.RETENTION_DAYS);
  const [usage, globalSpentUsd, retention] = await Promise.all([
    usageSummary(db, organizationId),
    monthSpendUsd(db),
    // Preview only — this page never deletes. It shows what the nightly job would remove,
    // so the policy is visible before and after anyone turns it on.
    previewRetention(db, { organizationId, retentionDays, previewDays: 90 }),
  ]);
  const globalCapUsd = parseGlobalCapUsd(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Uso e custo</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Quanto a IA custou este mês, por funcionalidade. Os valores são frações de
          centavo por chamada, por isso aparecem com quatro casas decimais.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <UsageCapCard
          title="Esta igreja"
          spentUsd={usage.totalUsd}
          capUsd={usage.monthlyUsd}
          overCapMessage="O limite do mês desta igreja foi atingido — novas chamadas de IA passam a ser recusadas até o próximo mês."
        />
        <UsageCapCard
          title="Limite global do demo (todas as igrejas)"
          spentUsd={globalSpentUsd}
          capUsd={globalCapUsd}
          overCapMessage="O limite global do demo foi atingido — toda chamada de IA está sendo recusada até o próximo mês, mesmo que esta igreja ainda tenha saldo próprio."
        />
      </div>

      <RetentionCard retentionDays={retentionDays} result={retention} cronConfigured={Boolean(process.env.CRON_SECRET)} />

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

function RetentionCard({ retentionDays, result, cronConfigured }: { retentionDays: number | null; result: RetentionResult; cronConfigured: boolean }) {
  const c = result.counts;
  const total = c.tickets + c.prayerRequests + c.conversations;
  const horizon = retentionDays ?? 90;
  return (
    <div className="rounded-xl border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Retenção de dados</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs ${retentionDays === null ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
          {retentionDays === null ? 'desativada' : `${retentionDays} dias`}
        </span>
      </div>
      <p className="mt-2 text-sm text-neutral-600">
        {retentionDays === null
          ? `Nada é apagado automaticamente. Se a retenção fosse de ${horizon} dias, a limpeza noturna removeria hoje:`
          : cronConfigured
            ? `Todo dia, conversas encerradas há mais de ${retentionDays} dias são apagadas. Hoje seriam removidos:`
            : `Retenção de ${retentionDays} dias configurada, mas a limpeza noturna não está autenticada (CRON_SECRET ausente) e por isso não roda. Hoje seriam removidos:`}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-neutral-500">Conversas</dt><dd className="font-medium">{c.conversations} <span className="text-xs text-neutral-500">({c.messages} mensagens)</span></dd></div>
        <div><dt className="text-xs text-neutral-500">Atendimentos resolvidos</dt><dd className="font-medium">{c.tickets}</dd></div>
        <div><dt className="text-xs text-neutral-500">Pedidos de oração concluídos</dt><dd className="font-medium">{c.prayerRequests}</dd></div>
        <div><dt className="text-xs text-neutral-500">Janelas de limite antigas</dt><dd className="font-medium">{c.rateLimitWindows}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-neutral-500">
        Atendimentos abertos e pedidos ainda não concluídos nunca são removidos, por mais antigos que sejam.
        Documentos, agenda, relatórios e o registro de uso também não. Mínimo configurável: {RETENTION_MIN_DAYS} dias
        ({total === 0 ? 'nada a remover hoje' : `${total} registro(s) elegíveis hoje`}).
      </p>
    </div>
  );
}
