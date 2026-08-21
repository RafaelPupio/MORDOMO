// Postgres rejects any non-UUID literal cast to a `uuid` column (every primary key in this
// schema — see src/db/schema.ts) with a DrizzleQueryError. Every id read out of untrusted
// `formData` in the staff area is checked against this shape FIRST, before it ever reaches a
// query, so a malformed id becomes a controlled "invalid" result instead of an uncaught
// error escaping a Server Action as a Next.js error digest.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
