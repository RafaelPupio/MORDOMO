import { describe, expect, it } from 'vitest';
import { buildSuggestReplyState } from '@/app/staff/(dashboard)/atendimentos/suggest-reply-state';
import type { SuggestTicketReplyResult } from '@/core/staff-operations';

const SOURCE = { documentId: 'doc-1', documentTitle: 'Horários', excerpt: 'Culto às 10h.', score: 0.9 };

describe('buildSuggestReplyState', () => {
  it('a fresh generation replaces reply and sources outright', () => {
    const result: SuggestTicketReplyResult = { reply: 'Novo rascunho.', sources: [SOURCE], generated: true };

    expect(buildSuggestReplyState({}, result)).toEqual({ reply: 'Novo rascunho.', sources: [SOURCE] });
  });

  it('a failed retry with a previous draft is reported as a notice, not a silent success (I2)', () => {
    const result: SuggestTicketReplyResult = { reply: 'Rascunho antigo.', sources: [], generated: false };

    const state = buildSuggestReplyState({}, result);

    expect(state.reply).toBe('Rascunho antigo.');
    expect(state.notice).toBeTruthy();
    expect(state.error).toBeUndefined();
  });

  it('does not blank sources already on screen when the retry falls back to the stale draft (I2)', () => {
    const result: SuggestTicketReplyResult = { reply: 'Rascunho antigo.', sources: [], generated: false };

    const state = buildSuggestReplyState({ reply: 'Rascunho antigo.', sources: [SOURCE] }, result);

    expect(state.sources).toEqual([SOURCE]);
  });

  it('a fresh generation with no sources still clears out any stale ones (nothing to keep hidden)', () => {
    const result: SuggestTicketReplyResult = { reply: 'Novo rascunho, sem fontes.', sources: [], generated: true };

    const state = buildSuggestReplyState({ reply: 'Antigo.', sources: [SOURCE] }, result);

    expect(state.sources).toEqual([]);
  });

  it('a draft that never existed at all (never generated, nothing saved) is a plain error', () => {
    const result: SuggestTicketReplyResult = { reply: '', sources: [], generated: false };

    expect(buildSuggestReplyState({}, result)).toEqual({
      error: 'Não foi possível gerar uma sugestão agora. Escreva a resposta manualmente abaixo.',
    });
  });
});
