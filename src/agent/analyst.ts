import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { FAST_MODEL, priceableModelId } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import type { WeekActivity } from '@/core/week-activity';
import type { Db } from '@/db/client';

export type AnalystDeps = { db: Db; model?: LanguageModel };
export type AnalystInput = { churchId: string; activity: WeekActivity };

// This is the FIRST of the weekly digest's two agents (Plan 4). The analyst only ever
// produces structured findings — labels, counts, short phrases — never prose. A separate
// writer agent (next task) reads `WeekFindings` and turns it into the text a church
// office actually sees. The analyst's output below is NEVER shown directly to a human;
// that split is deliberate, so the analyst never has to write nicely and the writer never
// has to decide what is true.
export type WeekFindings = {
  topQuestions: { question: string; count: number }[];
  unansweredQuestions: string[];
  prayerThemes: { theme: string; count: number }[];
  notableTickets: string[];
  summaryStat: string;
};

const findingsSchema = z.object({
  topQuestions: z.array(z.object({
    question: z.string().describe(
      "A visitor question in the visitor's own words or a close paraphrase — never invented",
    ),
    count: z.number().describe(
      'How many times this question (or a close paraphrase) appears in the supplied sample — not an extrapolation to the full week',
    ),
  })).describe('The most frequently asked visitor questions this week, most common first'),
  unansweredQuestions: z.array(z.string()).describe(
    'Visitor questions the assistant likely did NOT resolve on its own — see the "unanswered" rule in the system prompt',
  ),
  prayerThemes: z.array(z.object({
    theme: z.string().describe(
      'A short, general category label (e.g. "saude", "familia", "luto", "emprego") — NEVER a quote, a paraphrase, or any identifying detail of a specific request',
    ),
    count: z.number().describe('How many prayer requests in the sample fall under this theme'),
  })).describe(
    'Prayer requests grouped into aggregate themes only. This is the one field with a hard privacy rule — see the system prompt.',
  ),
  notableTickets: z.array(z.string()).describe(
    'Ticket topics worth the church office\'s attention this week, drawn from the supplied ticket topics',
  ),
  summaryStat: z.string().describe(
    "One short factual sentence giving the week's shape using the supplied counts — a plain stat, not a narrative",
  ),
});

const SYSTEM = [
  'You are the analyst stage of a two-stage weekly church digest. You read one church\'s real activity for a week and extract structured findings; a separate writer agent turns your findings into prose for the church office. You never write narrative prose yourself: return plain factual labels and short phrases, not sentences (summaryStat is the only field that is a sentence, and even it must stay a plain stat).',
  '',
  'Work ONLY from the activity supplied in the prompt. Never invent a question, theme, or ticket that is not grounded in the supplied lists — if you are unsure whether something is grounded, leave it out. An empty array is a correct and useful answer when the data does not support a finding; never pad any list just to look more complete.',
  '',
  'A question belongs in unansweredQuestions only when the supplied activity gives a real signal that the assistant did not resolve it on its own: either its topic matches one of the supplied ticket topics (a ticket means a human had to step in), or it — or a close paraphrase of it — recurs multiple times among the visitor questions, which suggests people kept asking because the previous answer did not satisfy them. Do not mark a question unanswered just because it sounds hard or open-ended; that is a guess, not a signal.',
  '',
  'PRIVACY RULE — this is the one that matters most: prayerThemes are AGGREGATE CATEGORIES ONLY, never quotes or paraphrases of an individual prayer request. Group the supplied prayer requests into general themes (health, family, grief, guidance, employment, and so on) and count how many fall into each theme. Never let a name, a diagnosis, a relationship, or any other identifying detail from a single request survive into a theme label. A digest that lets the church office read back "Maria\'s husband has cancer" is a privacy failure even though the church already owns that data — the whole point of a theme is that no single request is recoverable from it. When in doubt, use a broader, less specific theme.',
  '',
  'topQuestions.count and prayerThemes.count describe what you observed in the supplied sample, not an extrapolation to the true weekly total — a busy week\'s sample can be a capped subset.',
].join('\n');

function formatList(items: string[]): string {
  return items.length > 0 ? items.map((item, i) => `${i + 1}. ${item}`).join('\n') : '(nenhum)';
}

function buildPrompt(activity: WeekActivity): string {
  return [
    `PERÍODO: ${activity.periodStart.toISOString()} a ${activity.periodEnd.toISOString()}`,
    `CONTAGENS REAIS DA SEMANA (não estão limitadas pela amostra abaixo): ${JSON.stringify(activity.counts)}`,
    '',
    'PERGUNTAS DOS VISITANTES (amostra, mais recentes primeiro):',
    formatList(activity.visitorQuestions),
    '',
    'PEDIDOS DE ORAÇÃO (amostra, mais recentes primeiro):',
    formatList(activity.prayerRequests),
    '',
    'TÓPICOS DE TICKETS ABERTOS (amostra, mais recentes primeiro):',
    formatList(activity.ticketTopics),
  ].join('\n');
}

function emptyFindings(): WeekFindings {
  return {
    topQuestions: [],
    unansweredQuestions: [],
    prayerThemes: [],
    notableTickets: [],
    summaryStat: 'Nenhuma atividade registrada nesta semana.',
  };
}

export async function analyzeWeek(deps: AnalystDeps, input: AnalystInput): Promise<WeekFindings | null> {
  const { activity } = input;

  // A week where nothing happened is itself a valid finding, and reporting it costs
  // nothing: every sample list gatherWeekActivity produces is guaranteed empty whenever
  // every TRUE count is zero, so there is nothing here for a model to reason about.
  // Calling it anyway would spend money to reformat silence, and worse, invites exactly
  // the kind of invention the system prompt forbids. The digest job that calls
  // analyzeWeek is expected to skip the call entirely for an empty week (see
  // src/core/week-activity.ts) — this guard exists so the "zero model calls for an empty
  // week" guarantee holds even if a caller invokes analyzeWeek anyway.
  const hasActivity = activity.counts.conversations > 0
    || activity.counts.visitorMessages > 0
    || activity.counts.prayerRequests > 0
    || activity.counts.tickets > 0;
  if (!hasActivity) return emptyFindings();

  const model = deps.model ?? FAST_MODEL;
  const pricedModel = priceableModelId(model, FAST_MODEL);

  let object: WeekFindings;
  let usage: { inputTokens?: number; outputTokens?: number };
  try {
    ({ object, usage } = await generateObject({
      model,
      schema: findingsSchema,
      system: SYSTEM,
      prompt: buildPrompt(activity),
      // Generous for five short structured lists over a bounded (MAX_ITEMS_PER_KIND)
      // sample, while still ruling out an unbounded response.
      maxOutputTokens: 2048,
    }));
  } catch (error) {
    // The caller must be able to decline to publish a report rather than publish
    // fabricated findings, so a total failure here returns null instead of throwing —
    // never a caller's problem to catch.
    console.error('report.analyze: generateObject failed, declining to publish findings for this week', {
      churchId: input.churchId, error,
    });
    return null;
  }

  try {
    await recordUsage(deps.db, {
      churchId: input.churchId,
      feature: 'report.analyze',
      model: pricedModel,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
  } catch (error) {
    // A ledger-write failure must not discard findings the model already produced —
    // the digest is still worth publishing even if this one accounting write was lost.
    console.error('report.analyze usage not recorded', {
      churchId: input.churchId, error,
    });
  }

  return object;
}
