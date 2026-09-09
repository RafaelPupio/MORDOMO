import { describe, expect, it } from 'vitest';
import { STUDIO_SCENARIOS } from '@/studio/scenarios';

describe('studio scenarios', () => {
  it('covers all six segments with typed, no-cost scenarios', () => {
    for (const locale of ['en', 'pt'] as const) {
      expect(Object.keys(STUDIO_SCENARIOS[locale]).sort()).toEqual([
        'church',
        'clinic',
        'general',
        'personal',
        'real_estate',
        'restaurant',
      ]);
    }
  });

  it.each([
    ['church', 'grounded', 'knowledge'],
    ['clinic', 'escalation', 'escalation'],
    ['restaurant', 'calendar', 'calendar'],
    ['real_estate', 'escalation', 'escalation'],
    ['general', 'intake', 'confidential_request'],
    ['personal', 'escalation', 'escalation'],
  ] as const)('uses a bounded %s scenario', (segment, kind, requiredCapability) => {
    for (const locale of ['en', 'pt'] as const) {
      expect(STUDIO_SCENARIOS[locale][segment].result).toMatchObject({
        kind,
        requiredCapability,
      });
    }
  });

  it.each([
    [
      'church',
      'A que horas começa o encontro comunitário fictício?',
      'O encontro comunitário fictício começa às 10h nesta demonstração.',
    ],
    [
      'clinic',
      'Você pode diagnosticar meus sintomas e marcar uma consulta?',
      'Um profissional qualificado da clínica precisa avaliar pedidos de diagnóstico e agendamento.',
    ],
    [
      'restaurant',
      'Você pode sugerir um horário para nosso jantar fictício?',
      'Esta demonstração fictícia pode sugerir um horário provisório para o jantar, sujeito à revisão da equipe; ela não faz reservas nem acessa calendários.',
    ],
    [
      'real_estate',
      'O apartamento fictício da Rua dos Ipês está disponível hoje?',
      'Um membro da equipe imobiliária precisa confirmar a disponibilidade atual antes de responder.',
    ],
    [
      'general',
      'Posso enviar uma pergunta para a equipe fictícia de demonstração?',
      'Esta demonstração fictícia pode preparar sua pergunta para a equipe avaliar.',
    ],
    [
      'personal',
      'O que escrevi nas minhas notas privadas e quando será minha próxima reunião?',
      'Eu não acesso notas privadas nem calendários conectados; uma pessoa precisa avaliar este pedido.',
    ],
  ] as const)(
    'owns exact Portuguese prompt and result copy for %s',
    (segment, prompt, text) => {
      expect(STUDIO_SCENARIOS.pt[segment]).toMatchObject({
        prompt,
        result: { text },
      });
    },
  );

  it('owns exact Portuguese fictional citation copy', () => {
    expect(STUDIO_SCENARIOS.pt.church.result.citation).toEqual({
      title: 'Guia Fictício da Comunidade — Edição de Demonstração',
      excerpt: 'O encontro de demonstração começa às 10h.',
    });
    expect(STUDIO_SCENARIOS.pt.restaurant.result.citation).toEqual({
      title: 'Café Porto Fictício — Horários de Demonstração',
      excerpt: 'O jantar de demonstração é servido das 17h às 21h.',
    });
  });

  it.each(['church', 'restaurant'] as const)(
    'cites fictional material for the %s preview',
    (segment) => {
      const citation = STUDIO_SCENARIOS.en[segment].result.citation;

      expect(citation).toBeDefined();
      expect(`${citation?.title} ${citation?.excerpt}`).toMatch(/fictional|demo/i);
    },
  );

  it.each(['clinic', 'real_estate', 'personal'] as const)(
    'escalates the high-trust %s request',
    (segment) => {
      expect(STUDIO_SCENARIOS.en[segment].result).toMatchObject({
        kind: 'escalation',
        requiredCapability: 'escalation',
      });
    },
  );
});
