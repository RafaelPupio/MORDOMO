import { summarizeFindings } from './findings';

// "Show your work" for the digest, mirroring the agenda page's provenance panel
// (src/app/staff/(dashboard)/agenda/page.tsx: "Como a IA confirmou isso") — the writer's
// prose is a summary OF `findings`, so a reader who wants to check it against the source
// data (not just trust the prose) needs the structured version right there, not buried in
// the database. Only the three fields the brief calls out (top questions, unanswered,
// prayer themes) — `notableTickets` and `summaryStat` are already restated in the prose
// itself and would just duplicate it here.
export function FindingsSummary({ findings }: { findings: unknown }) {
  const { topQuestions, unansweredQuestions, prayerThemes } = summarizeFindings(findings);

  if (topQuestions.length === 0 && unansweredQuestions.length === 0 && prayerThemes.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 sm:grid-cols-3">
      <div>
        <p className="font-medium text-neutral-500">Perguntas mais frequentes</p>
        {topQuestions.length === 0 ? (
          <p className="mt-1 italic">Nenhuma.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {topQuestions.map((q) => (
              <li key={q.question}>{q.question} <span className="text-neutral-400">({q.count}x)</span></li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="font-medium text-neutral-500">Sem resposta clara</p>
        {unansweredQuestions.length === 0 ? (
          <p className="mt-1 italic">Nenhuma.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {unansweredQuestions.map((q) => <li key={q}>{q}</li>)}
          </ul>
        )}
      </div>

      <div>
        <p className="font-medium text-neutral-500">Temas de oração</p>
        {prayerThemes.length === 0 ? (
          <p className="mt-1 italic">Nenhum.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {prayerThemes.map((t) => (
              <li key={t.theme}>{t.theme} <span className="text-neutral-400">({t.count}x)</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
