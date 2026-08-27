import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { WeekFindings } from '@/agent/analyst';
import { CHAT_MODEL, priceableModelId } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import type { WeekActivity } from '@/core/week-activity';
import type { Db } from '@/db/client';

export type ReportWriterDeps = { db: Db; model?: LanguageModel };
export type ReportWriterInput = {
  organizationId: string;
  organizationName: string;
  findings: WeekFindings;
  activity: WeekActivity;
};

// This is the SECOND of the weekly digest's two agents (Plan 4). The analyst
// (src/agent/analyst.ts) already decided what is TRUE — structured, bounded `WeekFindings`
// from the week's real activity. The writer's only job is deciding how
// to SAY it: turn those findings into the Portuguese markdown a church office actually
// reads. Splitting the two is deliberate so neither has to do the other's job: the
// analyst never has to write nicely, and the writer never has to decide what is true —
// it is handed `findings` and trusted to stay inside them.
function formatList(items: string[]): string {
  return items.length > 0 ? items.map((item, i) => `${i + 1}. ${item}`).join('\n') : '(nenhuma)';
}

// PRIVACY: `activity` is part of this agent's input type (so the digest can state which
// week it covers), but only `periodStart`/`periodEnd`/`counts`/`costUsd` — aggregate
// numbers, none of them free text — are ever read here. `activity.visitorQuestions`,
// `.prayerRequests`, and `.ticketTopics` are the RAW samples gatherWeekActivity pulled
// straight from the database (see src/core/week-activity.ts) and are never touched by
// this function or included in the prompt. The analyst already reduced that raw text
// into `findings` (short labels and counts; `prayerThemes` alone is a closed, aggregate
// vocabulary), which is the ONLY
// source of "what happened this week" the writer is given. Reaching into `activity` for
// prose fodder would reintroduce exactly the identifiable detail the analyst's privacy
// rule exists to strip out — see the PRIVACY line in SYSTEM below.
function buildPrompt(input: ReportWriterInput): string {
  const { organizationName, findings, activity } = input;
  return [
    `IGREJA: ${organizationName}`,
    `PERÍODO: ${activity.periodStart.toISOString()} a ${activity.periodEnd.toISOString()}`,
    `CONTAGENS DA SEMANA: ${JSON.stringify(activity.counts)}`,
    `CUSTO DE IA DA SEMANA (USD): US$ ${activity.costUsd.toFixed(4)}`,
    '',
    'PERGUNTAS MAIS FREQUENTES DOS VISITANTES:',
    findings.topQuestions.length > 0
      ? findings.topQuestions.map((q, i) => `${i + 1}. ${q.question} (${q.count}x)`).join('\n')
      : '(nenhuma)',
    '',
    'PERGUNTAS SEM RESPOSTA CLARA (a equipe deve dar atenção):',
    formatList(findings.unansweredQuestions),
    '',
    'TEMAS DE ORAÇÃO (categorias agregadas — nunca citações de pedidos individuais):',
    findings.prayerThemes.length > 0
      ? findings.prayerThemes.map((t) => `${t.theme}: ${t.count}`).join('\n')
      : '(nenhum)',
    '',
    'TICKETS NOTÁVEIS:',
    formatList(findings.notableTickets),
    '',
    `ESTATÍSTICA-RESUMO: ${findings.summaryStat}`,
  ].join('\n');
}

const SYSTEM = [
  'Você é o estágio de redação de um resumo semanal em dois estágios para a secretaria de uma igreja. Um agente analista separado já leu a atividade real da semana e produziu "findings" — rótulos, contagens e frases curtas, estruturados. Você não viu essa atividade bruta e não precisa dela: escreva SOMENTE a partir dos findings fornecidos abaixo, em português do Brasil, em markdown, com tom caloroso e claro, adequado para uma secretaria de igreja ler rapidamente.',
  '',
  'PRIVACY: os findings não incluem amostras brutas de pedidos de oração, mensagens ou tickets. Os temas de oração são categorias agregadas de vocabulário fechado (ex.: "saúde", "família"), nunca uma citação ou paráfrase de um pedido específico. As perguntas e tickets são rótulos operacionais curtos fornecidos pelo analista, não uma garantia estrutural de anonimização. Nunca invente, reconstrua ou tente adivinhar um detalhe identificável (um nome, um diagnóstico, um relacionamento) para qualquer tema, pergunta ou ticket — escreva apenas os rótulos e contagens fornecidos, nada mais específico.',
  '',
  'Não invente nenhum fato, número ou tópico que não esteja presente nos findings abaixo. Se uma lista estiver vazia ou marcada "(nenhuma)"/"(nenhum)", diga isso de forma simples ou omita essa seção — nunca a preencha para parecer mais completa.',
  '',
  'Estrutura sugerida: uma linha de abertura curta nomeando a igreja e o período; uma seção com as perguntas mais frequentes dos visitantes; uma seção sinalizando perguntas sem resposta clara para a equipe acompanhar; uma seção de temas de oração (somente agregados); uma seção de tickets notáveis; e um fechamento com a estatística-resumo e o custo de IA da semana fornecido. Use títulos em markdown e parágrafos curtos ou listas — isto é lido por uma secretaria ocupada, não é um relatório para ser admirado.',
  '',
  'Responda apenas com o texto do resumo em markdown — sem preâmbulo, sem comentários fora do resumo em si.',
].join('\n');

export async function writeReport(deps: ReportWriterDeps, input: ReportWriterInput): Promise<string> {
  // Model choice: CHAT_MODEL, not FAST_MODEL (the default every other agent in this repo
  // uses — extractor, verifier, analyst, reply-drafter). Every one of those runs on a hot
  // path: once per uploaded document, once per visitor message, once per ticket — volume
  // where FAST_MODEL's lower cost multiplies into real savings and its structured-output
  // task (JSON matching a schema) doesn't need a stronger model's prose judgment. The
  // writer is the opposite on both axes. It is the ONE place in this product where prose
  // quality IS the deliverable — the analyst already guarantees factual grounding, so
  // what is left for this call to get right is register, structure, and readability, the
  // things a stronger chat model is better at. And it runs once a week per church, not
  // once per message, so CHAT_MODEL's higher per-call price barely moves the aggregate
  // cost the way it would on a hot path. Metered below via `priceableModelId` either way,
  // so a future override (or a cheaper model becoming "good enough") is never hardcoded.
  const model = deps.model ?? CHAT_MODEL;

  try {
    const { text, usage } = await generateText({
      model,
      system: SYSTEM,
      prompt: buildPrompt(input),
      // Generous for a markdown digest built from five short, bounded findings lists,
      // while still ruling out an unbounded response.
      maxOutputTokens: 2048,
    });

    try {
      await recordUsage(deps.db, {
        organizationId: input.organizationId,
        feature: 'report.write',
        model: priceableModelId(model, CHAT_MODEL),
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      });
    } catch (error) {
      // A ledger-write failure must not discard a report body the model already
      // produced — the digest is still worth publishing even if this one accounting
      // write was lost.
      console.error('report.write usage not recorded', { organizationId: input.organizationId, error });
    }

    return text.trim();
  } catch (error) {
    // The caller must be able to decline to publish a report rather than publish an
    // empty or broken one, so a total failure here returns '' instead of throwing —
    // never a caller's problem to catch.
    console.error('report.write: generateText failed, returning an empty body', {
      organizationId: input.organizationId, error,
    });
    return '';
  }
}
