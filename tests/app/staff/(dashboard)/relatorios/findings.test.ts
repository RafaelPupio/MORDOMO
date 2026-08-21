import { describe, expect, it } from 'vitest';
import { summarizeFindings } from '@/app/staff/(dashboard)/relatorios/findings';

const WELL_FORMED = {
  topQuestions: [{ question: 'Qual o horário do culto?', count: 5 }],
  unansweredQuestions: ['Vocês têm estacionamento?'],
  prayerThemes: [{ theme: 'saúde', count: 3 }],
  notableTickets: ['Pedido de visita pastoral'],
  summaryStat: '1 conversa nesta semana.',
};

describe('summarizeFindings', () => {
  it('extracts the three fields the page shows from a well-formed WeekFindings payload', () => {
    expect(summarizeFindings(WELL_FORMED)).toEqual({
      topQuestions: [{ question: 'Qual o horário do culto?', count: 5 }],
      unansweredQuestions: ['Vocês têm estacionamento?'],
      prayerThemes: [{ theme: 'saúde', count: 3 }],
    });
  });

  it('defaults every field to an empty list for null findings, without throwing', () => {
    expect(summarizeFindings(null)).toEqual({ topQuestions: [], unansweredQuestions: [], prayerThemes: [] });
  });

  it('defaults every field to an empty list for undefined findings, without throwing', () => {
    expect(summarizeFindings(undefined)).toEqual({ topQuestions: [], unansweredQuestions: [], prayerThemes: [] });
  });

  it('defaults every field to an empty list when findings is not an object at all (a stray string)', () => {
    expect(summarizeFindings('not an object')).toEqual({ topQuestions: [], unansweredQuestions: [], prayerThemes: [] });
  });

  it('defaults an individual field to an empty list when that field is entirely missing', () => {
    expect(summarizeFindings({})).toEqual({ topQuestions: [], unansweredQuestions: [], prayerThemes: [] });
  });

  it('defaults an individual field to an empty list when it is present but not an array', () => {
    expect(summarizeFindings({ topQuestions: 'not an array', unansweredQuestions: 42, prayerThemes: null })).toEqual({
      topQuestions: [],
      unansweredQuestions: [],
      prayerThemes: [],
    });
  });

  it('drops a topQuestions item missing its "question" field instead of crashing or emitting undefined', () => {
    const findings = { topQuestions: [{ count: 5 }, { question: 'Válida', count: 2 }] };

    expect(summarizeFindings(findings).topQuestions).toEqual([{ question: 'Válida', count: 2 }]);
  });

  it('drops a prayerThemes item missing its "theme" field the same way', () => {
    const findings = { prayerThemes: [{ count: 3 }, { theme: 'família', count: 1 }] };

    expect(summarizeFindings(findings).prayerThemes).toEqual([{ theme: 'família', count: 1 }]);
  });

  it('drops a non-string entry from unansweredQuestions rather than rendering it', () => {
    const findings = { unansweredQuestions: ['Válida', 42, null, { not: 'a string' }] };

    expect(summarizeFindings(findings).unansweredQuestions).toEqual(['Válida']);
  });

  it('coerces a missing or non-numeric count to 0 instead of NaN or undefined', () => {
    const findings = {
      topQuestions: [{ question: 'Sem count' }, { question: 'Count inválido', count: 'cinco' }, { question: 'NaN', count: NaN }],
    };

    expect(summarizeFindings(findings).topQuestions).toEqual([
      { question: 'Sem count', count: 0 },
      { question: 'Count inválido', count: 0 },
      { question: 'NaN', count: 0 },
    ]);
  });
});
