// Lives here, not beside the upload action that calls it: that module is
// `'use server'`, and Next allows a Server Action module to export ONLY async
// functions. Exporting this synchronous helper from there type-checked, linted and
// unit-tested green, then failed `next build` with "Server Actions must be async
// functions" — which is why CI now runs the build too.

/**
 * Turns an `IngestResult` into one sentence a secretary can act on. The distinction that
 * matters is WHY no event was published: nothing dated in the document is a normal
 * outcome, everything rejected is a review prompt, and a failed extraction is neither.
 */
export function describeIngest(result: {
  chunkCount: number;
  extracted: number;
  published: number;
  rejected: number;
  extractionFailed: boolean;
  truncatedForExtraction: boolean;
}): string {
  const parts = [`Documento processado: ${result.chunkCount} trechos indexados`];

  if (result.extractionFailed) {
    parts.push('a leitura de eventos falhou — a agenda não foi alterada');
  } else if (result.extracted === 0) {
    parts.push('nenhum evento com data encontrado');
  } else if (result.published === 0) {
    parts.push(`${result.extracted} evento(s) encontrado(s), todos rejeitados na verificação`);
  } else {
    parts.push(`${result.published} de ${result.extracted} evento(s) publicado(s)`);
    if (result.rejected > 0) parts.push(`${result.rejected} rejeitado(s) na verificação`);
  }

  if (result.truncatedForExtraction) {
    parts.push('só o início do documento foi lido em busca de eventos');
  }

  return `${parts.join(', ')}.`;
}
