# Decisions log

Append-only. Newest at the bottom of each day, newest day at the top.

## 2026-08-18 — founding decisions

- **Purpose: portfolio first, V1 upgrade later.** V2 exists to showcase ten AI
  capabilities (agents, multi-agent, RAG, chatbots, workflow automation, document
  processing, knowledge bases, reporting, customer support, data extraction) in one
  coherent product — built so it can genuinely become V1's next generation, not a
  throwaway demo.
- **Totally separate from V1.** Own folder, own repo, own brain. V1 stays untouched;
  its brain never records V2 work.
- **Channel: web chat first, WhatsApp-ready.** WhatsApp is a poor portfolio surface
  (nothing to click). The message core is channel-agnostic behind a `Channel` adapter;
  a WhatsApp adapter is a future file, not a rewrite.
- **Bilingual bot, English shell.** The bot answers in the visitor's language (itself a
  "V1 couldn't do this" showcase). Landing page, dashboard chrome, README: English, for
  an international portfolio audience.
- **One seeded fictional church now; sandbox-ready architecture.** Visitors chat with a
  richly seeded fictional Brazilian church. Every table keyed by `church_id` (V1's
  founding move), so a bring-your-own-church sandbox is later scope, not a rewrite.
  Zero real data → zero LGPD exposure in the public demo.
- **Budget: $10–50/mo with hard caps.** Sonnet where quality shows, Haiku elsewhere.
  Per-visitor rate limits, per-tenant token budgets, global cap with graceful
  degradation. V1 is a paid monthly subscription, so per-tenant metering
  (`usage_ledger`) is an architectural feature — it will power real pricing later.
- **Orchestration: hybrid (Approach 3).** Chat path = one secretary agent with tools
  (fast, cheap, reliable — it's what visitors touch first). Multi-agent only where it
  earns its keep: ingest (extractor → verifier) and weekly report (analyst → writer),
  both async. The "why multi-agent here but not there" reasoning is itself portfolio
  material.
- **Repo is PUBLIC, curated.** Rafael: "show our work without showing too much, just
  enough for portfolio." Code, spec, and technical brain are public; pricing/competitor
  strategy and V1 SaaS internals stay in the private V1 repo. Exception to the
  personal-repos-private convention, deliberate.
- **Pricing & competitor comparison deferred.** Build first, then price with real usage
  numbers from the ledger.

## 2026-08-19 — planning decisions

- **Spec approved; build decomposed into 4 plans**, each ending in working software:
  (1) foundation + chat slice, (2) ingest pipeline, (3) staff operations, (4) reporting
  + portfolio shell. One plan = one implementation cycle; Plan 1 creates all tables so
  migrations stay linear.
- **Embeddings: `openai/text-embedding-3-small` (1536 dims) via AI Gateway** — cheap
  ($0.02/M tokens), good multilingual-enough quality for pt-BR at demo scale. No vector
  index yet: exact scan is fine for hundreds of chunks.
- **Tests run on PGlite + pgvector in-memory**, injected via a driver-agnostic `Db`
  type; dev/prod use Neon (dev on the default branch, prod on a `production` branch of
  the same Neon project). Fast, free, no Docker.
- **Model pricing constants are assumptions** (Sonnet $3/$15, Haiku $1/$5 per M) until
  real gateway invoices are observed; single source of truth in `src/ai/pricing.ts`.
- **Deterministic `HashEmbedder`** (bag-of-words, unit-normalized) stands in for the
  real embedder in tests and offline seeding, so retrieval tests assert real ranking
  behavior without an API key.

## 2026-08-20 — decisions forced by building Plan 1

- **Conversation ownership rests on a server-minted httpOnly cookie (`ccb_visitor`), not
  on the client's IP.** A review demonstrated a working hijack: the original design keyed
  ownership on `x-forwarded-for`, so replaying a victim's IP with their `conversationId`
  let an attacker append to their conversation. The cookie is unguessable and
  server-issued on every response path. IP-derived identity is now used only for
  best-effort rate limiting, and that limit is only load-bearing behind Vercel.
- **Two separate request bounds, because one number cannot do both jobs.**
  `HISTORY_ABUSE_MAX_CHARS` (256k, serialized) rejects abuse with a 400;
  `MODEL_HISTORY_CHARS` (24k) silently trims the oldest turns so the model never sees
  more than that. A single 24k hard limit was tried first and **broke normal use** — a
  citation-bearing conversation died with a permanent 400 at turn 9. A single message
  larger than the model budget is rejected outright, since a real chat turn is not a
  document.
- **Bounds are measured on SERIALIZED size, not on text fields.** Summing `part.text`
  missed tool-output and file parts entirely — a 2 MB tool-output part bypassed the cap
  by ~400x and was also persisted verbatim into `messages.parts`.
- **Each church fact gets its own `##` section in the seed corpus.** Measured against the
  real chunker, a bulletin that bundled five events into one chunk made "qual o endereço?"
  and "quando é o encontro dos jovens?" return the *wrong* chunk as their only citation —
  worse for the demo than answering "I don't know". Restructured: `npm run
  benchmark:retrieval` (`scripts/retrieval-benchmark.ts`, committed 2026-08-20) now scores
  10/10 on the ten benchmark questions — but that number is offline only, scored against the
  deterministic bag-of-words `HashEmbedder`, not yet against the real `GatewayEmbedder`
  (`openai/text-embedding-3-small`) that will actually serve visitors. Re-running the
  benchmark with `BENCHMARK_REAL_EMBEDDER=1` against a real production seed is a gate before
  the demo is public — word-overlap ranking behavior is not guaranteed to transfer to a
  semantic embedding model.
- **Citation excerpts are centred on the matching text**, with ellipsis markers, instead
  of taking the first 400 characters — otherwise the sentence that earned the match could
  be invisible in the citation shown to the visitor.
- **`SEED_FAKE_EMBEDDER` must never seed the public demo.** Its vectors are not semantic;
  the seed script now warns loudly. Production seeding uses the gateway embedder.
- **AI SDK reality checks (ai@7.0.68):** `convertToModelMessages` is async, so
  `runSecretary` is async; plain gateway model strings work for embeddings; provider-level
  usage/finishReason shapes differ from the SDK-level ones the app consumes.

## 2026-08-20 — Plan 2, Task 6: `POST /api/ingest` gated by a placeholder shared secret

- **`INGEST_TOKEN` is a deliberate placeholder, not real staff auth.** Plan 1 shipped with
  no staff authentication, and Plan 3 owns the dashboard and its real auth. Without
  *some* gate, a public deployment's ingest pipeline (parse → embed → extract → verify,
  metered LLM/embedding calls) would be free document processing for any stranger who
  found the URL. Until Plan 3 lands, `POST /api/ingest` requires
  `Authorization: Bearer <INGEST_TOKEN>`, checked with a constant-time comparison
  (`node:crypto`'s `timingSafeEqual`). **Fails closed**: an unset or empty `INGEST_TOKEN`
  rejects every request with 401 — it can never degrade into "everyone may ingest" the way
  a naive `if (!token || token === expected)` inversion could. This must be revisited when
  Plan 3 ships real staff auth; the env var and this gate should be retired then, not
  layered under the new auth.
- **Unsupported-media-type is parsed and rejected *before* `createDocument` runs**, so a
  bad upload (e.g. an image) never leaves an orphan `documents` row. `runIngest`'s own
  first pipeline stage parses the same bytes again — a deliberate double-parse, cheap at
  demo scale, that keeps "no orphan row on rejection" simple instead of threading a
  pre-parsed result through `runIngest`'s public contract.
- **Gate order is auth → body validation → size (`file.size`, checked before the body is
  read into memory) → rate limit (10/church/hour) → budget** — the same shape as the chat
  channel's gates in `src/channels/web.ts`, so a request that will be rejected anyway never
  consumes a rate-limit slot or a budget check it shouldn't.

## 2026-08-20 — Plan 2

Proven end to end by `tests/e2e/ingest-to-answer.test.ts`: a freshly ingested bulletin
becomes retrievable and cited by the secretary, and its verified event lands on the
calendar the agent reads. That test also settles the shape of the whole pipeline, so this
entry records the design decisions it depends on and why each one is the shape it is —
not just the Task 6 gate already logged above.

- **The verifier is a separate model call with a disprove-it prompt, not a second pass by
  the extractor.** An extractor asked to re-check its own output tends to agree with
  itself — it already committed to the candidate once, and a self-review shares the same
  blind spots that produced the hallucination in the first place. The verifier instead
  gets a narrower, adversarial framing: "treat the candidate as a claim to be disproved,
  not a summary to be agreed with," with its own system prompt and its own call per
  candidate. Two independent passes over the same evidence catch more than one pass
  asked to grade itself, for the price of one extra cheap (`FAST_MODEL`) call per
  candidate — a few tenths of a cent per bulletin even with five events.
- **The pipeline fails closed on verification failure.** If the verifier's model call
  throws (gateway outage, malformed output), `verifyEvents` catches it per-candidate and
  returns `decision: 'rejected'` with a note explaining the automatic check failed — it
  never lets the exception propagate into an unreviewed "confirmed". An event that could
  not be checked is exactly as untrustworthy as one that failed the check; the visible
  cost is a real event missing from the calendar until the next ingest run, which is
  recoverable, versus the alternative of quietly publishing something nobody actually
  verified, which is not.
- **Deterministic quote and date guards run in the extractor, before any candidate reaches
  the verifier.** Checking that `sourceQuote` actually occurs in the document text and
  that `startsAt` parses to a real date costs nothing (`Date.parse` and a string search)
  next to a model call, and it catches the two most common hallucination shapes —
  invented text, invented dates — without spending a verifier call, or model judgment, on
  a candidate that was never going to survive review anyway. The verifier's job is then
  narrower and better-focused: adjudicate candidates that are at least structurally real,
  not reject garbage.
- **The quote guard tolerates typography drift but not invented content.** A model
  "copying" a quote verbatim commonly still retypes an em dash as a hyphen, straightens a
  curly apostrophe, or drops an accent — none of which mean the model invented anything.
  `normalizeForQuoteMatch` folds exactly those variants (dash forms, quote forms,
  diacritics) before comparing, but the check is still a full substring test on the
  normalized strings, not a fuzzy or partial match — an empty, whitespace-only, or
  genuinely absent quote is still rejected. Widening the tolerance to catch benign
  retyping without also learning to accept plausible-sounding invention was worth getting
  precisely right; `tests/agent/extractor.test.ts` pins both directions (drift accepted,
  invention rejected) so the boundary can't drift by accident later.
- **Re-ingest replaces rather than appends.** A document's chunks and any events sourced
  from it are deleted and reinserted on every `runIngest` call, keyed by
  `(churchId, documentId)`. A bulletin gets corrected and re-uploaded under the same
  `documentId` more often than it gets uploaded once and never touched again; if ingest
  appended, every correction would leave the stale chunks and the stale (now-wrong, or
  duplicate) event sitting alongside the new ones, silently degrading retrieval and the
  calendar in a way nothing would ever surface. Replace makes the document's ingested
  state always match its latest content — there is exactly one live version.
- **The delete is ordered late, after the new content is fully computed, because
  `neon-http` has no transaction support.** Production connects through `neon-http` (see
  `src/db/client.ts`), which throws "No transactions support in neon-http driver" on
  `db.transaction` — so nothing wraps the delete-then-insert in a rollback-on-failure
  boundary. `runIngest` compensates by ordering the work instead: parse, chunk, and embed
  the new content — all of which can fail on their own (a transient embedding-API outage
  is the realistic case) — complete *before* the old chunks are touched, and the delete
  and the insert that follows it have nothing awaitable between them. A failure anywhere
  before that point leaves the previous, already-published chunks (and events) exactly as
  they were, still serving answers; a failure can now only land in the narrow window
  between delete and insert, not across the whole pipeline. (PGlite, the test driver,
  does support `db.transaction` — but wrapping only the test path would verify a safety
  property production doesn't actually have, so the ordering, not a transaction, is what's
  used everywhere.)
- **`published` is terminal in the `ingest_status` state machine, with one narrow,
  documented bypass in `beginIngestRun`.** `canTransition('published', 'parsing')` is
  `false` and is tested: an automatic transition must never pull a document that is
  already serving answers back into the pipeline out from under a caller who didn't ask
  for that. Re-ingesting a published document is a different thing — an explicit,
  caller-initiated action — so `beginIngestRun` special-cases exactly that one starting
  status to land on `parsing`, while every other starting status (`uploaded`, `failed`)
  still goes through the ordinary, machine-checked `setIngestStatus`. The bypass is scoped
  to a single named function with its reasoning written on it, specifically so it can't be
  mistaken for a general "just set the status" escape hatch by a future caller.
- **The ingest endpoint is token-gated as a placeholder for Plan 3's auth, and the token
  should be retired, not stacked, when real auth lands.** This is the fuller context for
  the Task 6 entry above: `INGEST_TOKEN` exists only because Plan 1 shipped with no staff
  authentication and a public deployment cannot leave metered LLM/embedding work open to
  anyone who finds the URL. It is scaffolding, not a security layer meant to compound —
  when Plan 3 ships real staff auth, the correct move is to delete the bearer-token check
  and the env var, not leave both bolted on underneath the new auth as a second gate
  nobody remembers the purpose of.
