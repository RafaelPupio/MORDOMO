// Small, dependency-free home for config parsing shared across routes. Kept separate from
// any one route's module (e.g. src/app/api/chat/route.ts, where this used to live) so that
// importing it does NOT pull that route's whole module graph (Next.js route handlers,
// the secretary agent, etc.) into an unrelated bundle — see M6 in the ingest security
// review: src/app/api/ingest/route.ts used to import parseGlobalCapUsd from the chat
// route purely to reuse this one function, dragging the entire chat stack into the
// ingest bundle along with it.

// This is the only cost control set by hand in a dashboard, so it's also the only one that
// can be typo'd. `Number("abc")` is `NaN`, and every `spend >= NaN` comparison in
// checkBudget() is false — a malformed value doesn't just misconfigure the cap, it deletes
// it (fails OPEN). checkBudget already fails closed when a tenant has no budget row at all;
// this parse must fail closed the same way. A missing OR malformed value both degrade to the
// same conservative default rather than "no cap" — the only difference is that malformed
// values are logged, since they indicate an operator mistake worth noticing.
export const DEFAULT_GLOBAL_CAP_USD = 50;

export function parseGlobalCapUsd(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_GLOBAL_CAP_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error('DEMO_GLOBAL_MONTHLY_USD_CAP is not a valid positive number; falling back to the default cap', {
      raw,
      defaultUsd: DEFAULT_GLOBAL_CAP_USD,
    });
    return DEFAULT_GLOBAL_CAP_USD;
  }
  return parsed;
}

// Shared, for the same "one neutral module, not one route's" reason as the cap parsing
// above: `POST /api/ingest` (src/channels/ingest-http.ts) and the staff dashboard's upload
// form (src/app/staff/(dashboard)/documentos/actions.ts) both run the SAME `runIngest`
// pipeline for the SAME tenant, and both are reachable by the same authenticated staff
// session — that route accepts the identical `ccb_staff` session cookie the dashboard form
// does. Before this fix they rate-limited themselves against two separate keys
// (`ingest:${organizationId}` vs `staff-ingest:${organizationId}`) with two separately-declared-but-
// identical `{ limit: 10, windowSeconds: 3600 }` objects, so one staff session could run the
// pipeline 20 times/hour — double either limit's own intent — just by alternating which path
// it used. Both call sites now share this ONE constant and the SAME rate-limit key
// (`ingest:${organizationId}`), so the numbers can't silently drift apart again either (M5, the
// Plan 3 whole-branch review).
export const INGEST_LIMIT = { limit: 10, windowSeconds: 3600 };
