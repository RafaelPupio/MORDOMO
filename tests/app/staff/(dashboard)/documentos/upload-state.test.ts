import { describe, expect, it } from 'vitest';
import { buildUploadState } from '@/app/staff/(dashboard)/documentos/upload-state';

const published = {
  status: 'published' as const,
  chunkCount: 7,
  extracted: 4,
  published: 4,
  rejected: 0,
  extractionFailed: false,
  eventsReplaced: true,
  truncatedForExtraction: false,
};

// The review of the first describeIngest found "a leitura de eventos falhou" rendering in the
// green success slot. Which slot an outcome lands in is decided here and nowhere else.
describe('buildUploadState', () => {
  it('puts a clean publish in the green slot', () => {
    const state = buildUploadState(published);
    expect(state.ok).toContain('4 de 4 evento(s) verificado(s) publicado(s)');
    expect(state.notice).toBeUndefined();
    expect(state.error).toBeUndefined();
  });

  it('puts a failed extraction in the amber slot, not the green one', () => {
    const state = buildUploadState({ ...published, extracted: 0, published: 0, extractionFailed: true, eventsReplaced: false });
    expect(state.notice).toContain('a leitura de eventos falhou');
    expect(state.ok).toBeUndefined();
  });

  it('puts an all-rejected run in the amber slot', () => {
    const state = buildUploadState({ ...published, published: 0, rejected: 4 });
    expect(state.notice).toContain('todos rejeitados');
    expect(state.ok).toBeUndefined();
  });

  it('puts a verification outage in the amber slot', () => {
    const state = buildUploadState({ ...published, published: 0, rejected: 4, eventsReplaced: false });
    expect(state.notice).toContain('ficou indisponível');
    expect(state.ok).toBeUndefined();
  });

  it('reserves the red slot for a run that ended failed', () => {
    const state = buildUploadState({ ...published, status: 'failed' });
    expect(state.error).toContain('A leitura do documento falhou');
    expect(state.ok).toBeUndefined();
    expect(state.notice).toBeUndefined();
  });
});
