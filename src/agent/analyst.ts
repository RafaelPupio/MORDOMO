import { generateObject, NoObjectGeneratedError } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { FAST_MODEL, priceableModelId } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import type { WeekActivity } from '@/core/week-activity';
import type { Db } from '@/db/client';

export type AnalystDeps = { db: Db; model?: LanguageModel };
export type AnalystInput = { churchId: string; activity: WeekActivity };

// C1 (privacy): prayer themes are the one field that can leak an identifiable detail
// (a name, a diagnosis, a relationship) straight into a church office's digest, and the
// system prompt's privacy paragraph alone is advisory — a fast, cheap structured-output
// model can and does ignore it. A CLOSED VOCABULARY is the only genuinely STRUCTURAL
// defense: a name and a diagnosis cannot be expressed by picking one of these labels, so
// `theme` is a `z.enum` over this fixed list, not a free-form string. 'outro' is the
// explicit catch-all the prompt steers the model toward for anything that doesn't fit —
// see the note on `findingsSchema.prayerThemes` below for what happens when the model
// ignores that steering and emits an off-list value anyway.
export const PRAYER_THEME_VALUES = [
  'saúde',
  'família',
  'luto',
  'orientação',
  'emprego',
  'finanças',
  'fé',
  'relacionamentos',
  'viagem',
  'gratidão',
  'outro',
] as const;
export type PrayerTheme = typeof PRAYER_THEME_VALUES[number];

// This is the FIRST of the weekly digest's two agents (Plan 4). The analyst only ever
// produces structured findings — labels, counts, short phrases — never prose. A separate
// writer agent (next task) reads `WeekFindings` and turns it into the text a church
// office actually sees. The analyst's output below is NEVER shown directly to a human;
// that split is deliberate, so the analyst never has to write nicely and the writer never
// has to decide what is true.
export type WeekFindings = {
  topQuestions: { question: string; count: number }[];
  unansweredQuestions: string[];
  prayerThemes: { theme: PrayerTheme; count: number }[];
  notableTickets: string[];
  summaryStat: string;
};

const findingsSchema = z.object({
  topQuestions: z.array(z.object({
    question: z.string().describe(
      "A visitor question in the visitor's own words or a close paraphrase — never invented",
    ),
    // Not bounded here — see the comment on `count` clamping in `analyzeWeek` for why: a
    // per-item bound in the schema would let one bad count discard the whole week.
    count: z.number().describe(
      'How many times this question (or a close paraphrase) appears in the supplied sample — not an extrapolation to the full week',
    ),
  })).describe('The most frequently asked visitor questions this week, most common first'),
  unansweredQuestions: z.array(z.string()).describe(
    'Visitor questions the assistant likely did NOT resolve on its own — see the "unanswered" rule in the system prompt',
  ),
  prayerThemes: z.array(z.object({
    // `z.enum`, not `z.string()`: a name, a diagnosis, or a relationship cannot survive
    // being forced into one of these fixed labels. This is the structural half of the
    // privacy fix — belt and braces alongside the prompt's privacy paragraph, not a
    // replacement for it.
    //
    // Trade-off, deliberately accepted: `generateObject` validates the WHOLE payload in
    // one shot, so a model that emits a theme outside this list fails the ENTIRE week's
    // findings, not just that one item (the same atomicity problem `extractor.ts` solved
    // for `confidence` by NOT bounding it in the schema — bounding CAN'T be done that way
    // here, because the bound itself, a closed category set, is the whole point of the
    // fix). The prompt steers the model toward 'outro' for anything that doesn't cleanly
    // fit one of the named categories, which should keep this rare in practice. When it
    // still happens, `generateObject` throws `NoObjectGeneratedError` and `analyzeWeek`'s
    // existing null-on-failure path takes over: the week's digest is declined rather than
    // published with a bad or half-scrubbed theme. A theme that never reaches the return
    // value can never reach a church office.
    theme: z.enum(PRAYER_THEME_VALUES).describe(
      'A general prayer-request CATEGORY, chosen from the fixed list in the schema — NEVER a quote, a paraphrase, a name, a diagnosis, or any other identifying detail. Use "outro" for anything that does not cleanly fit one of the other categories.',
    ),
    count: z.number().describe('How many prayer requests in the sample fall under this theme'),
  })).describe(
    'Prayer requests grouped into aggregate themes only, from a fixed category list. This is the one field with a hard privacy rule — see the system prompt.',
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
  `PRIVACY RULE — this is the one that matters most: prayerThemes.theme is a CLOSED VOCABULARY. You must choose one of exactly these values for every theme: ${PRAYER_THEME_VALUES.join(', ')}. Group the supplied prayer requests into these general categories and count how many fall into each one. Use "outro" whenever a request does not cleanly fit one of the named categories — never invent a new label, and never let a name, a diagnosis, a relationship, or any other identifying detail from a single request survive into a theme. A digest that lets the church office read back "Maria\'s husband has cancer" is a privacy failure even though the church already owns that data — the whole point of a theme is that no single request is recoverable from it. When in doubt, prefer a broader category over a narrower one, and prefer "outro" over inventing anything outside this list.`,
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
    // never a caller's problem to catch. This branch is ALSO how the C1 privacy fix
    // fails closed: an off-vocabulary (or identifying) `theme` fails the `z.enum` check,
    // generateObject throws NoObjectGeneratedError for the whole payload, and we land
    // here — no findings, so nothing can reach a church office.
    console.error('report.analyze: generateObject failed, declining to publish findings for this week', {
      churchId: input.churchId, error,
    });
    // I2: NoObjectGeneratedError sometimes still carries `usage` for the failed attempt
    // (the call was made and billed even though the output was unusable, e.g. a
    // schema-invalid response) — record it when present, so the spend is not silently
    // lost; when it isn't present, log loudly that this call went unmetered instead of
    // letting the gap pass silently. Same precedent as src/agent/extractor.ts.
    const failureUsage = NoObjectGeneratedError.isInstance(error) ? error.usage : undefined;
    if (failureUsage && ((failureUsage.inputTokens ?? 0) > 0 || (failureUsage.outputTokens ?? 0) > 0)) {
      try {
        await recordUsage(deps.db, {
          churchId: input.churchId,
          feature: 'report.analyze',
          model: pricedModel,
          inputTokens: failureUsage.inputTokens ?? 0,
          outputTokens: failureUsage.outputTokens ?? 0,
        });
      } catch (usageError) {
        console.error('report.analyze usage not recorded after generateObject failure', {
          churchId: input.churchId, error: usageError,
        });
      }
    } else {
      console.error('report.analyze call went unmetered: generateObject failed with no usage to record', {
        churchId: input.churchId,
      });
    }
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

  // I3: liberal at the schema boundary, strict in our own code — same precedent as
  // `confidence` in src/agent/extractor.ts. `count` is left as a plain, unbounded
  // `z.number()` in the schema (see the comment there) so one item's bad count can't
  // invalidate the whole week's findings via the atomic-payload validation, and is
  // clamped to a non-negative integer here instead, once each item is in hand. This
  // catches a negative count (-5), a non-integer count (3.7), and any other
  // non-finite/NaN value a model might emit; it does not (and cannot) verify that a
  // count is a plausible fraction of the sample it was drawn from — that is a judgment
  // call, not a type-safety one.
  return {
    ...object,
    topQuestions: object.topQuestions.map((q) => ({ ...q, count: clampNonNegativeInt(q.count) })),
    prayerThemes: object.prayerThemes.map((t) => ({ ...t, count: clampNonNegativeInt(t.count) })),
  };
}

function clampNonNegativeInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}
