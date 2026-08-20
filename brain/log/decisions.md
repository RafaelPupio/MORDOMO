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
