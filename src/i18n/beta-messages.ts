import { z } from 'zod';

export const betaLocaleSchema = z.enum(['en', 'pt']);
export type BetaLocale = z.infer<typeof betaLocaleSchema>;

export type BetaMessages = {
  context: {
    title: string;
    organization: string;
    personal: string;
    switchLabel: string;
  };
  profile: {
    title: string;
    assistantName: string;
    defaultLocale: string;
    replyTone: string;
    greeting: string;
    escalationCopy: string;
    enabledCapabilities: string;
    saveDraft: string;
    publish: string;
  };
  validation: {
    required: string;
    invalidProfile: string;
    unsupportedLocale: string;
  };
  scenarios: {
    title: string;
    run: string;
    groundedAnswer: string;
    escalate: string;
    unavailable: string;
  };
};

const englishMessages = {
  context: {
    title: 'Choose a secretary context',
    organization: 'Organization',
    personal: 'Personal Secretary',
    switchLabel: 'Switch context',
  },
  profile: {
    title: 'Secretary profile',
    assistantName: 'Assistant name',
    defaultLocale: 'Default language',
    replyTone: 'Reply tone',
    greeting: 'Greeting',
    escalationCopy: 'Escalation message',
    enabledCapabilities: 'Enabled capabilities',
    saveDraft: 'Save draft',
    publish: 'Publish profile',
  },
  validation: {
    required: 'This field is required.',
    invalidProfile: 'Review the profile fields and try again.',
    unsupportedLocale: 'Choose English or Portuguese.',
  },
  scenarios: {
    title: 'Deterministic tests',
    run: 'Run test',
    groundedAnswer: 'This test answers from the selected knowledge capability.',
    escalate: 'This test safely hands the request to a person.',
    unavailable: 'This capability is not enabled in the current profile.',
  },
} satisfies BetaMessages;

const portugueseMessages = {
  context: {
    title: 'Escolha o contexto da secretaria',
    organization: 'Organização',
    personal: 'Secretária Pessoal',
    switchLabel: 'Trocar contexto',
  },
  profile: {
    title: 'Perfil da secretaria',
    assistantName: 'Nome da assistente',
    defaultLocale: 'Idioma padrão',
    replyTone: 'Tom das respostas',
    greeting: 'Saudação',
    escalationCopy: 'Mensagem de encaminhamento',
    enabledCapabilities: 'Capacidades ativas',
    saveDraft: 'Salvar rascunho',
    publish: 'Publicar perfil',
  },
  validation: {
    required: 'Este campo é obrigatório.',
    invalidProfile: 'Revise os campos do perfil e tente novamente.',
    unsupportedLocale: 'Escolha inglês ou português.',
  },
  scenarios: {
    title: 'Testes determinísticos',
    run: 'Executar teste',
    groundedAnswer: 'Este teste responde usando a capacidade de conhecimento selecionada.',
    escalate: 'Este teste encaminha a solicitação com segurança para uma pessoa.',
    unavailable: 'Esta capacidade não está ativa no perfil atual.',
  },
} satisfies BetaMessages;

export const BETA_MESSAGES: Record<BetaLocale, BetaMessages> = {
  en: englishMessages,
  pt: portugueseMessages,
};

export function parseBetaLocale(value: string): BetaLocale | null {
  return betaLocaleSchema.safeParse(value).success ? (value as BetaLocale) : null;
}

export function getBetaMessages(locale: BetaLocale): BetaMessages {
  return BETA_MESSAGES[locale];
}
