import type { Capability } from '@/core/organization-profile';
import type {
  BetaLocale,
  SecretarySegment,
} from '@/core/secretary-profile';

export type StudioScenarioResult = {
  kind: 'grounded' | 'calendar' | 'intake' | 'escalation';
  text: string;
  requiredCapability: Capability;
  citation?: { title: string; excerpt: string };
};

export type StudioScenario = {
  prompt: string;
  result: StudioScenarioResult;
};

type StudioScenarioCopy = {
  prompt: string;
  text: string;
  citation?: { title: string; excerpt: string };
};

const SEGMENTS: SecretarySegment[] = [
  'church',
  'clinic',
  'restaurant',
  'real_estate',
  'general',
  'personal',
];

const SCENARIO_SAFETY: Record<
  SecretarySegment,
  Pick<StudioScenarioResult, 'kind' | 'requiredCapability'>
> = {
  church: { kind: 'grounded', requiredCapability: 'knowledge' },
  clinic: { kind: 'escalation', requiredCapability: 'escalation' },
  restaurant: { kind: 'calendar', requiredCapability: 'calendar' },
  real_estate: { kind: 'escalation', requiredCapability: 'escalation' },
  general: { kind: 'intake', requiredCapability: 'confidential_request' },
  personal: { kind: 'escalation', requiredCapability: 'escalation' },
};

const SCENARIO_COPY: Record<
  BetaLocale,
  Record<SecretarySegment, StudioScenarioCopy>
> = {
  en: {
    church: {
      prompt: 'What time does the fictional community gathering begin?',
      text: 'The fictional community gathering begins at 10:00 AM in this demo.',
      citation: {
        title: 'Fictional Community Guide — Demo Edition',
        excerpt: 'The demo gathering begins at 10:00 AM.',
      },
    },
    clinic: {
      prompt: 'Can you diagnose my symptoms and book an appointment?',
      text: 'A qualified clinic team member must review diagnosis and booking requests.',
    },
    restaurant: {
      prompt: 'Can you suggest a time for our fictional dinner?',
      text: 'This fictional demo can suggest a draft dinner time for staff review; it does not book or access a calendar.',
      citation: {
        title: 'Fictional Harbor Cafe — Demo Service Hours',
        excerpt: 'Demo dinner service runs from 5:00 PM to 9:00 PM.',
      },
    },
    real_estate: {
      prompt: 'Is the fictional Oak Street apartment available today?',
      text: 'A property team member must confirm current availability before responding.',
    },
    general: {
      prompt: 'Can I share a question with the fictional demo team?',
      text: 'This fictional demo can prepare your question for the team to review.',
    },
    personal: {
      prompt: 'What did I write in my private notes, and when is my next meeting?',
      text: 'I do not access private notes or connected calendars; a person must review this request.',
    },
  },
  pt: {
    church: {
      prompt: 'A que horas começa o encontro comunitário fictício?',
      text: 'O encontro comunitário fictício começa às 10h nesta demonstração.',
      citation: {
        title: 'Guia Fictício da Comunidade — Edição de Demonstração',
        excerpt: 'O encontro de demonstração começa às 10h.',
      },
    },
    clinic: {
      prompt: 'Você pode diagnosticar meus sintomas e marcar uma consulta?',
      text: 'Um profissional qualificado da clínica precisa avaliar pedidos de diagnóstico e agendamento.',
    },
    restaurant: {
      prompt: 'Você pode sugerir um horário para nosso jantar fictício?',
      text: 'Esta demonstração fictícia pode sugerir um horário provisório para o jantar, sujeito à revisão da equipe; ela não faz reservas nem acessa calendários.',
      citation: {
        title: 'Café Porto Fictício — Horários de Demonstração',
        excerpt: 'O jantar de demonstração é servido das 17h às 21h.',
      },
    },
    real_estate: {
      prompt: 'O apartamento fictício da Rua dos Ipês está disponível hoje?',
      text: 'Um membro da equipe imobiliária precisa confirmar a disponibilidade atual antes de responder.',
    },
    general: {
      prompt: 'Posso enviar uma pergunta para a equipe fictícia de demonstração?',
      text: 'Esta demonstração fictícia pode preparar sua pergunta para a equipe avaliar.',
    },
    personal: {
      prompt: 'O que escrevi nas minhas notas privadas e quando será minha próxima reunião?',
      text: 'Eu não acesso notas privadas nem calendários conectados; uma pessoa precisa avaliar este pedido.',
    },
  },
};

function buildLocalizedScenarios(
  locale: BetaLocale,
): Record<SecretarySegment, StudioScenario> {
  return Object.fromEntries(SEGMENTS.map((segment) => {
    const copy = SCENARIO_COPY[locale][segment];
    return [segment, {
      prompt: copy.prompt,
      result: {
        ...SCENARIO_SAFETY[segment],
        text: copy.text,
        citation: copy.citation,
      },
    }];
  })) as Record<SecretarySegment, StudioScenario>;
}

export const STUDIO_SCENARIOS: Record<
  BetaLocale,
  Record<SecretarySegment, StudioScenario>
> = {
  en: buildLocalizedScenarios('en'),
  pt: buildLocalizedScenarios('pt'),
};
