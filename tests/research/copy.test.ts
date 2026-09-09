import { describe, expect, it } from 'vitest';
import { RESEARCH_COPY } from '@/research/copy';
import { researchErrorCodeSchema } from '@/research/contracts';

const COPY_KEYS = [
  'eyebrow',
  'title',
  'description',
  'unavailable',
  'urlLabel',
  'urlHint',
  'cityLabel',
  'cityHint',
  'consent',
  'start',
  'retrieving',
  'proposing',
  'reviewTitle',
  'sourceLabel',
  'supportingQuote',
  'accept',
  'editAndAccept',
  'reject',
  'accepted',
  'rejected',
  'noGroundedFacts',
  'retry',
  'retryHint',
  'apply',
  'applied',
  'savedSeparately',
  'pending',
  'fieldErrors',
  'errors',
] as const;

describe('research copy', () => {
  it.each(['en', 'pt'] as const)('has a complete exact %s key set', (locale) => {
    expect(Object.keys(RESEARCH_COPY[locale]).sort()).toEqual(
      [...COPY_KEYS].sort(),
    );
    expect(Object.keys(RESEARCH_COPY[locale].fieldErrors).sort()).toEqual([
      'consentRequired',
      'reviewCity',
      'reviewUrl',
    ]);
    expect(Object.keys(RESEARCH_COPY[locale].errors).sort()).toEqual(
      [...researchErrorCodeSchema.options].sort(),
    );
  });

  it('keeps the approved English v2 consent exact', () => {
    expect(RESEARCH_COPY.en.consent).toBe(
      "I confirm this is a public website that my Organization may research. I approve sending its URL to a non-recorded, non-logged Browserbase session and sending a bounded public excerpt, our segment, optional city, and language through MORDOMO's AI Gateway to propose facts. MORDOMO will store the source, proposals, and my review decisions. Nothing will enter the secretary profile until I review, apply, save, and publish it. I will not submit confidential, personal, authenticated, or credential-bearing pages.",
    );
  });

  it('keeps the approved Portuguese v2 consent exact', () => {
    expect(RESEARCH_COPY.pt.consent).toBe(
      'Confirmo que este é um site público que minha Organização pode pesquisar. Autorizo o envio da URL para uma sessão do Browserbase sem gravação nem registro e o envio de um trecho público limitado, do nosso segmento, da cidade opcional e do idioma pelo AI Gateway do MORDOMO para propor fatos. O MORDOMO armazenará a fonte, as propostas e minhas decisões de revisão. Nada entrará no perfil da secretária até que eu revise, aplique, salve e publique. Não enviarei páginas confidenciais, pessoais, autenticadas ou que contenham credenciais.',
    );
  });

  it('gives distinct bilingual direction for validation, retry, stale state, and apply', () => {
    expect(RESEARCH_COPY.en.fieldErrors.reviewUrl).toBe('Review this public URL.');
    expect(RESEARCH_COPY.pt.fieldErrors.reviewUrl).toBe('Revise esta URL pública.');
    expect(RESEARCH_COPY.en.retry).toBe('Retry fact proposals');
    expect(RESEARCH_COPY.pt.retry).toBe('Tentar propostas novamente');
    expect(RESEARCH_COPY.en.errors.staleResearchState).toContain('Refresh');
    expect(RESEARCH_COPY.pt.errors.staleResearchState).toContain('Atualize');
    expect(RESEARCH_COPY.en.apply).toBe('Apply accepted facts to draft');
    expect(RESEARCH_COPY.pt.apply).toBe('Aplicar fatos aceitos ao rascunho');
  });
});
