/**
 * Documents state local wall-clock times ("às 10h"); `events.starts_at` stores UTC. That
 * conversion is the one fact the extractor and the verifier MUST agree on, and it is why
 * this sentence lives in a constant instead of being written out in two prompts.
 *
 * When only the extractor knew the rule, the verifier read every *correctly* converted
 * timestamp as a three-hour error and rejected it — its prompt tells it that a shifted
 * time means reject, and from where it stood the time had been shifted. That produced a
 * 100% false-rejection rate across the whole two-agent pipeline. It went unnoticed
 * because the seeded agenda events are fixtures inserted directly, so the first document
 * ever ingested in production (2026-09-05) was also the first real exercise of the pair:
 * seven candidates extracted, seven rejected, every note citing "deslocamento de 3 horas".
 *
 * Brazil abolished daylight saving in 2019, so the offset is a constant -3 year-round.
 */
export const CHURCH_TIMEZONE_NOTE = [
  'Church documents state local times in America/Sao_Paulo (UTC-3, no daylight saving).',
  'The startsAt field always expresses that SAME instant in UTC, so a document that says',
  '"às 10h" corresponds to startsAt 13:00Z on that date, and "às 18h30" to 21:30Z.',
].join(' ');
