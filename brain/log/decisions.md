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
