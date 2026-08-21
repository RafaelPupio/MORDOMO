// `reports.findings` (src/db/schema.ts) is a `jsonb` column with no `$type<WeekFindings>()`
// annotation, so a row read back from the database is typed `unknown`, not `WeekFindings`
// (src/agent/analyst.ts) — Postgres stores exactly what `generateObject`'s schema produced
// at write time, but nothing re-validates it on the way OUT. This module is that
// re-validation: it turns an `unknown` value into the three fields the page actually shows
// ("show your work" alongside the prose — see page.tsx), defaulting anything missing,
// mistyped, or malformed to an empty list rather than letting one bad item crash the page
// or a wrong-shaped field silently render as `undefined`. Kept dependency-free (no React)
// so the defensive parsing is unit-testable on its own, per the task's "extract and test"
// guidance for exactly this kind of boundary code.

export type FindingsSummary = {
  topQuestions: { question: string; count: number }[];
  unansweredQuestions: string[];
  prayerThemes: { theme: string; count: number }[];
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asFiniteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function summarizeFindings(findings: unknown): FindingsSummary {
  const root = asRecord(findings);

  const topQuestions = asArray(root.topQuestions)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> & { question: string } => typeof item.question === 'string')
    .map((item) => ({ question: item.question, count: asFiniteCount(item.count) }));

  const unansweredQuestions = asArray(root.unansweredQuestions)
    .filter((item): item is string => typeof item === 'string');

  const prayerThemes = asArray(root.prayerThemes)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> & { theme: string } => typeof item.theme === 'string')
    .map((item) => ({ theme: item.theme, count: asFiniteCount(item.count) }));

  return { topQuestions, unansweredQuestions, prayerThemes };
}
