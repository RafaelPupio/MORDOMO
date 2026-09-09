import type { BetaLocale } from '@/core/secretary-profile';
import type { ResearchErrorCode } from '@/research/contracts';

export type ResearchCopy = {
  eyebrow: string;
  title: string;
  description: string;
  unavailable: string;
  urlLabel: string;
  urlHint: string;
  cityLabel: string;
  cityHint: string;
  consent: string;
  start: string;
  retrieving: string;
  proposing: string;
  reviewTitle: string;
  sourceLabel: string;
  supportingQuote: string;
  accept: string;
  editAndAccept: string;
  reject: string;
  accepted: string;
  rejected: string;
  noGroundedFacts: string;
  retry: string;
  retryHint: string;
  apply: string;
  applied: string;
  savedSeparately: string;
  pending: string;
  fieldErrors: {
    reviewUrl: string;
    reviewCity: string;
    consentRequired: string;
  };
  errors: Record<ResearchErrorCode, string>;
};

export const RESEARCH_COPY: Record<BetaLocale, ResearchCopy> = {
  en: {
    eyebrow: 'EVIDENCE / PUBLIC',
    title: 'Public fact research',
    description: 'Inspect one approved public page, then decide which grounded facts belong in this draft.',
    unavailable: 'Public research is not available in this environment. No website data will be sent.',
    urlLabel: 'Approved public page',
    urlHint: 'One public HTTPS page without a query string or sign-in.',
    cityLabel: 'City (optional)',
    cityHint: 'Used only to make proposals more relevant.',
    consent: "I confirm this is a public website that my Organization may research. I approve sending its URL to a non-recorded, non-logged Browserbase session and sending a bounded public excerpt, our segment, optional city, and language through MORDOMO's AI Gateway to propose facts. MORDOMO will store the source, proposals, and my review decisions. Nothing will enter the secretary profile until I review, apply, save, and publish it. I will not submit confidential, personal, authenticated, or credential-bearing pages.",
    start: 'Start public research',
    retrieving: 'Retrieving public source',
    proposing: 'Proposing grounded facts',
    reviewTitle: 'Review every proposed fact',
    sourceLabel: 'Public source',
    supportingQuote: 'Supporting quote',
    accept: 'Accept unchanged',
    editAndAccept: 'Edit and accept',
    reject: 'Reject',
    accepted: 'Accepted',
    rejected: 'Rejected',
    noGroundedFacts: 'No grounded facts were found on this page. Start a new brief with another approved public page.',
    retry: 'Retry fact proposals',
    retryHint: 'The public source is already stored. Retrying calls only the metered proposal step.',
    apply: 'Apply accepted facts to draft',
    applied: 'Accepted facts are applied to this local draft.',
    savedSeparately: 'Save the profile draft, then publish it separately when it is ready.',
    pending: 'Updating research…',
    fieldErrors: {
      reviewUrl: 'Review this public URL.',
      reviewCity: 'Use a city name of 120 characters or fewer.',
      consentRequired: 'Confirm the current public-research consent.',
    },
    errors: {
      researchUnavailable: 'Public research is not available right now.',
      forbidden: 'This account cannot research for the active Organization.',
      invalidInput: 'Review the research fields and try again.',
      unsafeUrl: 'Use one public HTTPS page without credentials, a query string, or a fragment.',
      rateLimited: 'This Organization has reached its daily research limit.',
      budgetExhausted: 'The Organization or demo AI budget has been reached.',
      providerUnavailable: 'The public page could not be retrieved. Try again later.',
      retentionUnverified: 'Research is paused until non-recording and non-logging controls are verified.',
      noUsefulContent: 'That public page did not provide enough visible text.',
      proposalFailed: 'The source was saved, but fact proposals could not be produced.',
      ungroundedProposal: 'The proposals did not match their supporting quotes.',
      staleResearchState: 'This research changed in another request. Refresh the page before continuing.',
      notFound: 'This research item is not available in the active Organization.',
    },
  },
  pt: {
    eyebrow: 'EVIDÊNCIA / PÚBLICA',
    title: 'Pesquisa de fatos públicos',
    description: 'Inspecione uma página pública aprovada e decida quais fatos fundamentados pertencem a este rascunho.',
    unavailable: 'A pesquisa pública não está disponível neste ambiente. Nenhum dado de site será enviado.',
    urlLabel: 'Página pública aprovada',
    urlHint: 'Uma página HTTPS pública, sem parâmetros de busca nem login.',
    cityLabel: 'Cidade (opcional)',
    cityHint: 'Usada somente para tornar as propostas mais relevantes.',
    consent: 'Confirmo que este é um site público que minha Organização pode pesquisar. Autorizo o envio da URL para uma sessão do Browserbase sem gravação nem registro e o envio de um trecho público limitado, do nosso segmento, da cidade opcional e do idioma pelo AI Gateway do MORDOMO para propor fatos. O MORDOMO armazenará a fonte, as propostas e minhas decisões de revisão. Nada entrará no perfil da secretária até que eu revise, aplique, salve e publique. Não enviarei páginas confidenciais, pessoais, autenticadas ou que contenham credenciais.',
    start: 'Iniciar pesquisa pública',
    retrieving: 'Obtendo fonte pública',
    proposing: 'Propondo fatos fundamentados',
    reviewTitle: 'Revise cada fato proposto',
    sourceLabel: 'Fonte pública',
    supportingQuote: 'Trecho de apoio',
    accept: 'Aceitar sem alterações',
    editAndAccept: 'Editar e aceitar',
    reject: 'Rejeitar',
    accepted: 'Aceito',
    rejected: 'Rejeitado',
    noGroundedFacts: 'Nenhum fato fundamentado foi encontrado nesta página. Inicie uma nova pesquisa com outra página pública aprovada.',
    retry: 'Tentar propostas novamente',
    retryHint: 'A fonte pública já está armazenada. A nova tentativa chama somente a etapa medida de propostas.',
    apply: 'Aplicar fatos aceitos ao rascunho',
    applied: 'Os fatos aceitos foram aplicados a este rascunho local.',
    savedSeparately: 'Salve o rascunho do perfil e publique-o separadamente quando estiver pronto.',
    pending: 'Atualizando pesquisa…',
    fieldErrors: {
      reviewUrl: 'Revise esta URL pública.',
      reviewCity: 'Use um nome de cidade com até 120 caracteres.',
      consentRequired: 'Confirme o consentimento atual da pesquisa pública.',
    },
    errors: {
      researchUnavailable: 'A pesquisa pública não está disponível agora.',
      forbidden: 'Esta conta não pode pesquisar para a Organização ativa.',
      invalidInput: 'Revise os campos da pesquisa e tente novamente.',
      unsafeUrl: 'Use uma página HTTPS pública sem credenciais, parâmetros de busca ou fragmento.',
      rateLimited: 'Esta Organização atingiu o limite diário de pesquisas.',
      budgetExhausted: 'O orçamento de IA da Organização ou da demonstração foi atingido.',
      providerUnavailable: 'Não foi possível obter a página pública. Tente novamente mais tarde.',
      retentionUnverified: 'A pesquisa está pausada até a verificação dos controles sem gravação e sem registro.',
      noUsefulContent: 'Essa página pública não forneceu texto visível suficiente.',
      proposalFailed: 'A fonte foi salva, mas não foi possível produzir propostas de fatos.',
      ungroundedProposal: 'As propostas não corresponderam aos seus trechos de apoio.',
      staleResearchState: 'Esta pesquisa mudou em outra solicitação. Atualize a página antes de continuar.',
      notFound: 'Este item de pesquisa não está disponível na Organização ativa.',
    },
  },
};
