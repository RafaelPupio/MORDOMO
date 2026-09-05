// Lives here, not beside the upload action that calls it: that module is
// `'use server'`, and Next allows a Server Action module to export ONLY async
// functions. Exporting this synchronous helper from there type-checked, linted and
// unit-tested green, then failed `next build` with "Server Actions must be async
// functions" — which is why CI now runs the build too.

export type IngestOutcome = {
  chunkCount: number;
  extracted: number;
  published: number;
  rejected: number;
  extractionFailed: boolean;
  /** False when this run could not render a trustworthy verdict (verification outage or
   *  no verifier configured) and therefore left the document's previous events untouched
   *  — see `IngestResult.eventsReplaced` in src/core/ingest.ts. */
  eventsReplaced: boolean;
  truncatedForExtraction: boolean;
};

/**
 * True when the run needs a human to look, not just to read: the agenda was left as it
 * was for a reason the secretary should know, or candidates were found and none made it.
 * `buildUploadState` uses this to pick the amber slot over the green one — the first
 * version of this message put "a leitura de eventos falhou" in the success colour.
 */
export function ingestNeedsAttention(result: IngestOutcome): boolean {
  return result.extractionFailed
    || !result.eventsReplaced
    || (result.extracted > 0 && result.published === 0)
    || result.truncatedForExtraction;
}

/**
 * Turns an `IngestResult` into one sentence a secretary can act on. The distinction that
 * matters is WHY no event was published: nothing dated in the document is a normal
 * outcome, everything rejected is a review prompt, a verification outage is neither, and a
 * failed extraction is a retry. Every extracted candidate is accounted for — published,
 * rejected, or never verified because of the per-document candidate cap — so the counts
 * always add up to `extracted`.
 */
export function describeIngest(result: IngestOutcome): string {
  const parts = [`Documento processado: ${result.chunkCount} trechos indexados`];
  const verified = result.published + result.rejected;
  // Candidates beyond MAX_CANDIDATES (src/core/ingest.ts) never reach the verifier. They
  // are neither published nor rejected, and saying otherwise sends staff hunting for
  // wrong dates the auditor never looked at.
  const unverified = Math.max(0, result.extracted - verified);

  if (result.extractionFailed) {
    parts.push('a leitura de eventos falhou — a agenda não foi alterada');
  } else if (result.extracted === 0) {
    parts.push('nenhum evento com data encontrado');
  } else if (!result.eventsReplaced) {
    // Every verdict was an outage marker: nothing was judged, and src/core/ingest.ts kept
    // the previously published events precisely because "we could not check" is not "no".
    parts.push(
      `${result.extracted} evento(s) encontrado(s), mas a verificação automática ficou indisponível — a agenda não foi alterada, tente novamente`,
    );
  } else if (result.published === 0) {
    parts.push(`${verified} evento(s) verificado(s), todos rejeitados na verificação`);
  } else {
    parts.push(`${result.published} de ${verified} evento(s) verificado(s) publicado(s)`);
    if (result.rejected > 0) parts.push(`${result.rejected} rejeitado(s) na verificação`);
  }

  if (unverified > 0 && !result.extractionFailed && result.eventsReplaced) {
    parts.push(`${unverified} não verificado(s) — limite de candidatos por documento`);
  }

  if (result.truncatedForExtraction && !result.extractionFailed) {
    parts.push('só o início do documento foi lido em busca de eventos');
  }

  return `${parts.join(', ')}.`;
}
