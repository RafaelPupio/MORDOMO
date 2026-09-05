import { describe, expect, it } from 'vitest';
import { describeIngest, ingestNeedsAttention } from '@/core/ingest-summary';

const base = {
  chunkCount: 7,
  extracted: 0,
  published: 0,
  rejected: 0,
  extractionFailed: false,
  eventsReplaced: true,
  truncatedForExtraction: false,
};

// A bare "0 evento(s) publicado(s)" made three very different outcomes look identical.
// That is how a verifier bug rejecting 100% of correct candidates stayed invisible for a
// full production run — see src/agent/time-convention.ts. The review of that fix then found
// two more outcomes the first version of this sentence collapsed: a verification outage
// (nothing judged, agenda untouched) and candidates dropped by MAX_CANDIDATES.
describe('describeIngest', () => {
  it('says plainly when a document simply has no dated events', () => {
    expect(describeIngest(base)).toContain('nenhum evento com data encontrado');
  });

  it('distinguishes "all rejected" from "none found"', () => {
    const msg = describeIngest({ ...base, extracted: 7, rejected: 7 });
    expect(msg).toContain('7 evento(s) verificado(s), todos rejeitados');
    expect(msg).not.toContain('nenhum evento com data encontrado');
  });

  it('reports a partial publish with its rejection count', () => {
    const msg = describeIngest({ ...base, extracted: 6, published: 4, rejected: 2 });
    expect(msg).toContain('4 de 6 evento(s) verificado(s) publicado(s)');
    expect(msg).toContain('2 rejeitado(s)');
  });

  it('never reports a clean result when extraction itself failed', () => {
    const msg = describeIngest({ ...base, extractionFailed: true, eventsReplaced: false });
    expect(msg).toContain('a leitura de eventos falhou');
    expect(msg).toContain('a agenda não foi alterada');
    expect(msg).not.toContain('nenhum evento com data encontrado');
  });

  // runIngest returns exactly this shape when every verifier call throws: rejected === extracted,
  // published 0, eventsReplaced false (tests/core/ingest.test.ts pins it). Nothing was judged.
  it('does not claim a verdict when verification was unavailable', () => {
    const msg = describeIngest({ ...base, extracted: 2, rejected: 2, eventsReplaced: false });
    expect(msg).toContain('verificação automática ficou indisponível');
    expect(msg).toContain('a agenda não foi alterada');
    expect(msg).not.toContain('rejeitados na verificação');
  });

  // 13 candidates, MAX_CANDIDATES = 8: five were never sent to the verifier. They are neither
  // published nor rejected, and the sentence must say so instead of folding them into either.
  it('accounts for candidates the verifier never saw', () => {
    const all = describeIngest({ ...base, extracted: 13, published: 6, rejected: 2 });
    expect(all).toContain('6 de 8 evento(s) verificado(s) publicado(s)');
    expect(all).toContain('2 rejeitado(s)');
    expect(all).toContain('5 não verificado(s) — limite de candidatos por documento');

    const none = describeIngest({ ...base, extracted: 13, published: 0, rejected: 8 });
    expect(none).toContain('8 evento(s) verificado(s), todos rejeitados');
    expect(none).not.toContain('13 evento(s)');
    expect(none).toContain('5 não verificado(s)');
  });

  it('flags a document that was only partly read for events', () => {
    const msg = describeIngest({ ...base, extracted: 2, published: 2, truncatedForExtraction: true });
    expect(msg).toContain('só o início do documento foi lido');
  });

  it('does not say the document was read for events when extraction failed', () => {
    const msg = describeIngest({ ...base, extractionFailed: true, eventsReplaced: false, truncatedForExtraction: true });
    expect(msg).not.toContain('só o início do documento foi lido');
  });
});

describe('ingestNeedsAttention', () => {
  it('is false only for a clean publish', () => {
    expect(ingestNeedsAttention({ ...base, extracted: 3, published: 3 })).toBe(false);
    expect(ingestNeedsAttention({ ...base })).toBe(false);
  });

  it('is true for every outcome a secretary should look at', () => {
    expect(ingestNeedsAttention({ ...base, extractionFailed: true, eventsReplaced: false })).toBe(true);
    expect(ingestNeedsAttention({ ...base, extracted: 2, rejected: 2, eventsReplaced: false })).toBe(true);
    expect(ingestNeedsAttention({ ...base, extracted: 2, rejected: 2 })).toBe(true);
    expect(ingestNeedsAttention({ ...base, extracted: 2, published: 2, truncatedForExtraction: true })).toBe(true);
  });
});
