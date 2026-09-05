import { describe, expect, it } from 'vitest';
import { describeIngest } from '@/core/ingest-summary';

const base = {
  chunkCount: 7,
  extracted: 0,
  published: 0,
  rejected: 0,
  extractionFailed: false,
  truncatedForExtraction: false,
};

// A bare "0 evento(s) publicado(s)" made three very different outcomes look identical.
// That is how a verifier bug rejecting 100% of correct candidates stayed invisible for a
// full production run — see src/agent/time-convention.ts.
describe('describeIngest', () => {
  it('says plainly when a document simply has no dated events', () => {
    expect(describeIngest(base)).toContain('nenhum evento com data encontrado');
  });

  it('distinguishes "all rejected" from "none found"', () => {
    const msg = describeIngest({ ...base, extracted: 7, rejected: 7 });
    expect(msg).toContain('7 evento(s) encontrado(s), todos rejeitados');
    expect(msg).not.toContain('nenhum evento com data encontrado');
  });

  it('reports a partial publish with its rejection count', () => {
    const msg = describeIngest({ ...base, extracted: 6, published: 4, rejected: 2 });
    expect(msg).toContain('4 de 6 evento(s) publicado(s)');
    expect(msg).toContain('2 rejeitado(s)');
  });

  it('never reports a clean result when extraction itself failed', () => {
    const msg = describeIngest({ ...base, extractionFailed: true });
    expect(msg).toContain('a leitura de eventos falhou');
    expect(msg).toContain('a agenda não foi alterada');
    expect(msg).not.toContain('nenhum evento com data encontrado');
  });

  it('flags a document that was only partly read for events', () => {
    const msg = describeIngest({ ...base, extracted: 2, published: 2, truncatedForExtraction: true });
    expect(msg).toContain('só o início do documento foi lido');
  });
});
