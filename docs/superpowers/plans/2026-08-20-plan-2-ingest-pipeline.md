# Plan 2: Document Ingest Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A church document (PDF or markdown) can be ingested: parsed, chunked, embedded into the knowledge base, and — in the same run — mined by an **extractor agent** for structured events that a **verifier agent** audits against the source before any of them reach the calendar.

**Architecture:** One orchestrated pipeline over an explicit status machine on `documents.ingest_status`. Deterministic stages (parse → chunk → embed → publish) do the retrieval work; the two agent stages run after the text is known and never block retrieval. The verifier is the point of the multi-agent design: the extractor optimises for recall, the verifier independently checks each candidate against the source text and only confirmed events become visible. Every stage is idempotent and re-runnable, and every model call is metered.

**Tech Stack:** Existing (Next.js, Neon + pgvector, Drizzle, AI SDK v6 via Vercel AI Gateway, Vitest). New: `unpdf` for PDF text extraction; AI SDK `generateObject` with Zod schemas for both agents.

This is **Plan 2 of 4**. Plan 1 (chat vertical slice) is merged. Plan 3 is staff operations (dashboard/inboxes/UI); Plan 4 is reporting + the portfolio landing page. Spec: `docs/superpowers/specs/2026-08-18-mordomo-design.md`.

## Global Constraints

- Every table carries `church_id`; every query is tenant-scoped. No exceptions.
- Every LLM/embedding call is recorded in `usage_ledger` (tokens + cost, per tenant, per feature). Model constants live in `src/ai/pricing.ts` only — never hardcode a model string.
- Background/agent work uses `FAST_MODEL` (`anthropic/claude-haiku-4-5`); `CHAT_MODEL` stays for the visitor-facing chat.
- Node runtime only — never `runtime = 'edge'`.
- Public repo: no secrets, no `.env*` committed, fictional data only.
- A ledger-write failure must never destroy work that already succeeded (log it, carry on) — the pattern established in `src/agent/secretary.ts`.
- Code, comments, docs: English. Church-facing content: Portuguese.
- Tests run offline against PGlite + `HashEmbedder` + mock models. No network, no API key.

---

### Task 1: Ingest status machine + schema additions

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/core/ingest-status.ts`, `tests/core/ingest-status.test.ts`, `drizzle/000X_*.sql` (generated)

**Interfaces:**
- Consumes: existing `documents`, `events` tables.
- Produces: from `@/core/ingest-status`: `type IngestStatus = 'uploaded' | 'parsing' | 'extracting' | 'verifying' | 'published' | 'failed'`, `INGEST_STATUSES`, `canTransition(from, to): boolean`, `assertTransition(from, to): void` (throws on an illegal move). Schema gains `documents.ingest_error` (text, nullable), `documents.source_text` (text, nullable — the parsed plain text, so re-running extraction never re-parses), and `events.extraction_confidence` (real, nullable), `events.verification_note` (text, nullable), `events.source_quote` (text, nullable).

- [ ] **Step 1: Write the failing test `tests/core/ingest-status.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, INGEST_STATUSES } from '@/core/ingest-status';

describe('ingest status machine', () => {
  it('lists every status', () => {
    expect(INGEST_STATUSES).toEqual([
      'uploaded', 'parsing', 'extracting', 'verifying', 'published', 'failed',
    ]);
  });

  it('allows the happy path in order', () => {
    expect(canTransition('uploaded', 'parsing')).toBe(true);
    expect(canTransition('parsing', 'extracting')).toBe(true);
    expect(canTransition('extracting', 'verifying')).toBe(true);
    expect(canTransition('verifying', 'published')).toBe(true);
  });

  it('allows failing from any working state', () => {
    for (const s of ['uploaded', 'parsing', 'extracting', 'verifying'] as const) {
      expect(canTransition(s, 'failed')).toBe(true);
    }
  });

  it('allows retrying a failed document from the start', () => {
    expect(canTransition('failed', 'parsing')).toBe(true);
  });

  it('rejects skipping stages and rejects leaving a terminal success', () => {
    expect(canTransition('uploaded', 'published')).toBe(false);
    expect(canTransition('parsing', 'verifying')).toBe(false);
    expect(canTransition('published', 'parsing')).toBe(false);
    expect(canTransition('published', 'failed')).toBe(false);
  });

  it('assertTransition throws with both states named', () => {
    expect(() => assertTransition('uploaded', 'published')).toThrow(/uploaded.*published/);
    expect(() => assertTransition('uploaded', 'parsing')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/core/ingest-status.test.ts`
Expected: FAIL — cannot resolve `@/core/ingest-status`.

- [ ] **Step 3: Write `src/core/ingest-status.ts`**

```ts
// The ingest pipeline is a small explicit state machine so a half-finished or crashed
// run is always visibly in one known state, and so a retry can only resume from a legal
// point. `published` is terminal: a document that already serves answers is never
// silently pulled back into the pipeline — re-ingesting creates a new run from `parsing`.
export const INGEST_STATUSES = [
  'uploaded', 'parsing', 'extracting', 'verifying', 'published', 'failed',
] as const;

export type IngestStatus = (typeof INGEST_STATUSES)[number];

const ALLOWED: Record<IngestStatus, readonly IngestStatus[]> = {
  uploaded: ['parsing', 'failed'],
  parsing: ['extracting', 'failed'],
  extracting: ['verifying', 'failed'],
  verifying: ['published', 'failed'],
  published: [],
  failed: ['parsing'],
};

export function canTransition(from: IngestStatus, to: IngestStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: IngestStatus, to: IngestStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal ingest transition: ${from} -> ${to}`);
  }
}
```

- [ ] **Step 4: Add the schema columns**

In `src/db/schema.ts`, add to `documents`:

```ts
  ingestError: text('ingest_error'),
  sourceText: text('source_text'),
```

and to `events`:

```ts
  extractionConfidence: real('extraction_confidence'),
  verificationNote: text('verification_note'),
  sourceQuote: text('source_quote'),
```

`real` is already imported in this file; confirm before adding an import.

- [ ] **Step 5: Generate and apply the migration**

```bash
npm run db:generate
```

Read the generated SQL and confirm it only ADDS nullable columns (no drops, no rewrites). Do NOT run `db:migrate` — no database is provisioned in this environment; PGlite applies migrations from the folder during tests.

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/core/ingest-status.test.ts && npm test && npm run typecheck`
Expected: 6 new tests pass; full suite green (the new columns are nullable so existing tests are unaffected).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(ingest): explicit status machine and columns for extraction provenance"
```

---

### Task 2: Document parser (PDF + markdown/plain text)

**Files:**
- Create: `src/core/parse-document.ts`, `tests/core/parse-document.test.ts`, `tests/fixtures/` (a small generated PDF)
- Modify: `package.json` (add `unpdf`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: from `@/core/parse-document`: `type ParsedDocument = { text: string; pageCount: number | null }`, `parseDocument(bytes: Uint8Array, mimeType: string): Promise<ParsedDocument>`. Supports `application/pdf`, `text/markdown`, `text/plain`. Throws `UnsupportedMediaTypeError` (exported) for anything else.

- [ ] **Step 1: Install the PDF text extractor**

```bash
npm install unpdf
```

`unpdf` is a serverless-friendly build of pdf.js with no native dependencies.

- [ ] **Step 2: Write the failing test `tests/core/parse-document.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { parseDocument, UnsupportedMediaTypeError } from '@/core/parse-document';

const enc = (s: string) => new TextEncoder().encode(s);

describe('parseDocument', () => {
  it('passes markdown through unchanged and reports no page count', async () => {
    const md = '# Boletim\n\n## Culto\n\nDomingo às 10h.';
    const out = await parseDocument(enc(md), 'text/markdown');
    expect(out.text).toBe(md);
    expect(out.pageCount).toBeNull();
  });

  it('passes plain text through', async () => {
    const out = await parseDocument(enc('Culto de domingo às 10h.'), 'text/plain');
    expect(out.text).toContain('10h');
  });

  it('normalizes CRLF and trims trailing whitespace', async () => {
    const out = await parseDocument(enc('linha um\r\nlinha dois   \r\n'), 'text/plain');
    expect(out.text).toBe('linha um\nlinha dois');
  });

  it('rejects an unsupported media type by name', async () => {
    await expect(parseDocument(enc('x'), 'image/png')).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
    await expect(parseDocument(enc('x'), 'image/png')).rejects.toThrow(/image\/png/);
  });

  it('rejects empty input rather than producing an empty document', async () => {
    await expect(parseDocument(enc('   \n  '), 'text/plain')).rejects.toThrow(/empty/i);
  });

  it('extracts text and a page count from a real PDF', async () => {
    const pdf = await makeOnePagePdf('Culto de domingo as 10h');
    const out = await parseDocument(pdf, 'application/pdf');
    expect(out.text).toContain('Culto de domingo');
    expect(out.pageCount).toBe(1);
  });
});

// A minimal, valid single-page PDF written by hand — avoids committing a binary fixture
// and keeps the test honest (it exercises the real PDF code path, not a stub).
async function makeOnePagePdf(text: string): Promise<Uint8Array> {
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run tests/core/parse-document.test.ts`
Expected: FAIL — cannot resolve `@/core/parse-document`.

- [ ] **Step 4: Write `src/core/parse-document.ts`**

```ts
export type ParsedDocument = { text: string; pageCount: number | null };

export class UnsupportedMediaTypeError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported media type: ${mimeType}`);
    this.name = 'UnsupportedMediaTypeError';
  }
}

const TEXT_TYPES = new Set(['text/markdown', 'text/plain', 'text/x-markdown']);

export async function parseDocument(bytes: Uint8Array, mimeType: string): Promise<ParsedDocument> {
  const type = mimeType.split(';')[0].trim().toLowerCase();

  let text: string;
  let pageCount: number | null = null;

  if (type === 'application/pdf') {
    // Imported lazily: pdf.js is large, and the text paths must not pay for it.
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const extracted = await extractText(pdf, { mergePages: true });
    text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text;
    pageCount = extracted.totalPages ?? pdf.numPages ?? null;
  } else if (TEXT_TYPES.has(type)) {
    text = new TextDecoder().decode(bytes);
  } else {
    throw new UnsupportedMediaTypeError(mimeType);
  }

  text = normalize(text);
  if (!text) throw new Error('Parsed document is empty — nothing to ingest');
  return { text, pageCount };
}

function normalize(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}
```

If `unpdf`'s exported function names or result shape differ in the installed version, read `node_modules/unpdf/dist/index.d.ts` and use what it actually declares — do not guess.

- [ ] **Step 5: Run tests, full suite, typecheck**

Run: `npx vitest run tests/core/parse-document.test.ts && npm test && npm run typecheck`
Expected: 6 new tests pass; suite green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ingest): parse PDF and markdown documents into normalized text"
```

---

### Task 3: Extractor agent

**Files:**
- Create: `src/agent/extractor.ts`, `tests/agent/extractor.test.ts`

**Interfaces:**
- Consumes: `FAST_MODEL`, `recordUsage`, `type Db`.
- Produces: from `@/agent/extractor`: `type ExtractedEvent = { title: string; startsAt: string; location: string | null; description: string | null; confidence: number; sourceQuote: string }`, `extractEvents(deps, input): Promise<ExtractedEvent[]>` where `deps = { db: Db; model?: LanguageModel }` and `input = { churchId: string; documentId: string; text: string; referenceDate: string }`.

- [ ] **Step 1: Write the failing test `tests/agent/extractor.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { extractEvents } from '@/agent/extractor';
import { usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

// generateObject is exercised through a mock model that returns the JSON the schema
// expects, so the test verifies OUR contract (shape, defaults, metering, error
// handling), not the SDK's.
async function objectModel(payload: unknown) {
  const { MockLanguageModelV3 } = await import('ai/test');
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 120, noCache: 120 }, outputTokens: { total: 40, text: 40 } },
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      warnings: [],
    }),
  });
}

const TEXT = '## Encontro de jovens OTB — 10/10 (sábado)\n\nÀs 19h, na quadra coberta.';

describe('extractEvents', () => {
  it('returns the extracted events and meters the call', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await objectModel({
      events: [{
        title: 'Encontro de jovens OTB',
        startsAt: '2026-10-10T22:00:00Z',
        location: 'Quadra coberta',
        description: 'Tema: Fé e vocação',
        confidence: 0.9,
        sourceQuote: 'Encontro de jovens OTB — 10/10 (sábado)',
      }],
    });

    const out = await extractEvents({ db, model }, {
      churchId: church.id,
      documentId: crypto.randomUUID(),
      text: TEXT,
      referenceDate: '2026-10-01',
    });

    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Encontro de jovens OTB');
    expect(out[0].sourceQuote).toContain('Encontro de jovens');
    const ledger = await db.select().from(usageLedger);
    expect(ledger.some((u) => u.feature === 'ingest.extract' && u.inputTokens > 0)).toBe(true);
  });

  it('returns an empty array when the document has no events', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await objectModel({ events: [] });
    const out = await extractEvents({ db, model }, {
      churchId: church.id, documentId: crypto.randomUUID(),
      text: 'Palavra pastoral sobre gratidão.', referenceDate: '2026-10-01',
    });
    expect(out).toEqual([]);
  });

  it('drops events whose quote is not present in the source text', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await objectModel({
      events: [
        { title: 'Real', startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
          confidence: 0.9, sourceQuote: 'Encontro de jovens OTB' },
        { title: 'Inventado', startsAt: '2026-11-01T12:00:00Z', location: null, description: null,
          confidence: 0.9, sourceQuote: 'esta frase nao existe no documento' },
      ],
    });
    const out = await extractEvents({ db, model }, {
      churchId: church.id, documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01',
    });
    expect(out.map((e) => e.title)).toEqual(['Real']);
  });

  it('drops events with an unparseable date', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await objectModel({
      events: [{ title: 'Sem data', startsAt: 'quando der', location: null, description: null,
        confidence: 0.8, sourceQuote: 'Encontro de jovens OTB' }],
    });
    const out = await extractEvents({ db, model }, {
      churchId: church.id, documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01',
    });
    expect(out).toEqual([]);
  });

  it('does not fail the extraction when the ledger write throws', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await objectModel({
      events: [{ title: 'Real', startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
        confidence: 0.9, sourceQuote: 'Encontro de jovens OTB' }],
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await extractEvents(
      { db, model },
      { churchId: crypto.randomUUID(), documentId: crypto.randomUUID(), text: TEXT, referenceDate: '2026-10-01' },
    );
    expect(out).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/agent/extractor.test.ts`
Expected: FAIL — cannot resolve `@/agent/extractor`.

- [ ] **Step 3: Write `src/agent/extractor.ts`**

```ts
import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { FAST_MODEL } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import type { Db } from '@/db/client';

export type ExtractorDeps = { db: Db; model?: LanguageModel };
export type ExtractorInput = {
  churchId: string;
  documentId: string;
  text: string;
  /** ISO date the document is relative to, so "domingo que vem" can be resolved. */
  referenceDate: string;
};

export type ExtractedEvent = {
  title: string;
  startsAt: string;
  location: string | null;
  description: string | null;
  confidence: number;
  sourceQuote: string;
};

const eventSchema = z.object({
  title: z.string().describe('Nome do evento, como aparece no documento'),
  startsAt: z.string().describe('Data e hora de início em ISO 8601 (UTC)'),
  location: z.string().nullable().describe('Local, se mencionado'),
  description: z.string().nullable().describe('Detalhe curto, se houver'),
  confidence: z.number().min(0).max(1).describe('Confiança de que este é um evento real com data'),
  sourceQuote: z.string().describe('Trecho EXATO do documento que sustenta este evento'),
});

const extractionSchema = z.object({ events: z.array(eventSchema) });

function systemPrompt(referenceDate: string): string {
  return [
    'You extract calendar events from Brazilian church documents written in Portuguese.',
    `Today's reference date for resolving relative dates is ${referenceDate}. Assume times are America/Sao_Paulo (UTC-3) unless the document says otherwise, and output startsAt in UTC.`,
    'Extract ONLY events that have a date. Recurring weekly services stated as a general schedule are NOT events — skip them.',
    'sourceQuote must be copied verbatim from the document. Never paraphrase it, and never invent one: it is how a second reviewer checks your work.',
    'Prefer recall over precision — a low confidence value is better than omitting a plausible event, because everything you return is independently verified before it is published.',
    'Return an empty list when the document contains no dated events.',
  ].join('\n');
}

export async function extractEvents(
  deps: ExtractorDeps,
  input: ExtractorInput,
): Promise<ExtractedEvent[]> {
  const { object, usage } = await generateObject({
    model: deps.model ?? FAST_MODEL,
    schema: extractionSchema,
    system: systemPrompt(input.referenceDate),
    prompt: input.text,
  });

  try {
    await recordUsage(deps.db, {
      churchId: input.churchId,
      feature: 'ingest.extract',
      model: FAST_MODEL,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
  } catch (error) {
    console.error('ingest.extract usage not recorded', {
      churchId: input.churchId, documentId: input.documentId, error,
    });
  }

  // Two cheap, deterministic guards before any model-generated row goes further: the
  // quote must actually occur in the source, and the date must be real. These catch the
  // most common hallucination shapes without spending a second model call on them.
  return object.events.filter((event) => {
    if (!Number.isFinite(Date.parse(event.startsAt))) return false;
    return quoteAppearsIn(input.text, event.sourceQuote);
  });
}

function quoteAppearsIn(text: string, quote: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalize(text).includes(normalize(quote)) && quote.trim().length > 0;
}
```

- [ ] **Step 4: Run tests, full suite, typecheck**

Run: `npx vitest run tests/agent/extractor.test.ts && npm test && npm run typecheck`
Expected: 5 new tests pass; suite green.

If `generateObject`'s mock-model contract differs in ai@7.0.68 (e.g. it requires a `content` part of a particular shape, or `doGenerate` must return `text` rather than a content array), read `node_modules/ai/dist/index.d.ts` and `node_modules/ai/test/dist/index.d.ts` and mirror the declared shapes. Adapt the TEST, never the production types.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ingest): extractor agent with verbatim-quote and date guards"
```

---

### Task 4: Verifier agent

**Files:**
- Create: `src/agent/verifier.ts`, `tests/agent/verifier.test.ts`

**Interfaces:**
- Consumes: `FAST_MODEL`, `recordUsage`, `ExtractedEvent`.
- Produces: from `@/agent/verifier`: `type Verdict = { decision: 'confirmed' | 'rejected'; note: string }`, `type VerifiedEvent = ExtractedEvent & { verdict: Verdict }`, `verifyEvents(deps, input): Promise<VerifiedEvent[]>` with the same `deps` shape as the extractor and `input = { churchId: string; documentId: string; text: string; events: ExtractedEvent[] }`.

- [ ] **Step 1: Write the failing test `tests/agent/verifier.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ExtractedEvent } from '@/agent/extractor';
import { verifyEvents } from '@/agent/verifier';
import { usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

async function verdictModel(verdicts: { decision: string; note: string }[]) {
  const { MockLanguageModelV3 } = await import('ai/test');
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const v = verdicts[Math.min(call++, verdicts.length - 1)];
      return {
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 80, noCache: 80 }, outputTokens: { total: 20, text: 20 } },
        content: [{ type: 'text', text: JSON.stringify(v) }],
        warnings: [],
      };
    },
  });
}

const TEXT = '## Encontro de jovens OTB — 10/10 (sábado)\n\nÀs 19h, na quadra coberta.';

function candidate(overrides: Partial<ExtractedEvent> = {}): ExtractedEvent {
  return {
    title: 'Encontro de jovens OTB',
    startsAt: '2026-10-10T22:00:00Z',
    location: 'Quadra coberta',
    description: null,
    confidence: 0.9,
    sourceQuote: 'Encontro de jovens OTB — 10/10 (sábado)',
    ...overrides,
  };
}

describe('verifyEvents', () => {
  it('attaches a verdict to each candidate and meters one call per event', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await verdictModel([
      { decision: 'confirmed', note: 'Data e local conferem com o documento.' },
      { decision: 'rejected', note: 'O documento nao menciona este evento.' },
    ]);

    const out = await verifyEvents({ db, model }, {
      churchId: church.id,
      documentId: crypto.randomUUID(),
      text: TEXT,
      events: [candidate(), candidate({ title: 'Outro' })],
    });

    expect(out.map((e) => e.verdict.decision)).toEqual(['confirmed', 'rejected']);
    expect(out[0].verdict.note).toContain('conferem');
    const ledger = await db.select().from(usageLedger);
    expect(ledger.filter((u) => u.feature === 'ingest.verify')).toHaveLength(2);
  });

  it('returns an empty array without calling the model when there are no candidates', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    let called = false;
    const { MockLanguageModelV3 } = await import('ai/test');
    const model = new MockLanguageModelV3({
      doGenerate: async () => { called = true; throw new Error('should not be called'); },
    });
    const out = await verifyEvents({ db, model }, {
      churchId: church.id, documentId: crypto.randomUUID(), text: TEXT, events: [],
    });
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });

  it('rejects — never silently confirms — an event whose verification call fails', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const { MockLanguageModelV3 } = await import('ai/test');
    const model = new MockLanguageModelV3({
      doGenerate: async () => { throw new Error('gateway down'); },
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await verifyEvents({ db, model }, {
      churchId: church.id, documentId: crypto.randomUUID(), text: TEXT, events: [candidate()],
    });
    expect(out).toHaveLength(1);
    expect(out[0].verdict.decision).toBe('rejected');
    expect(out[0].verdict.note).toMatch(/falhou|failed/i);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/agent/verifier.test.ts`
Expected: FAIL — cannot resolve `@/agent/verifier`.

- [ ] **Step 3: Write `src/agent/verifier.ts`**

```ts
import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { ExtractedEvent } from '@/agent/extractor';
import { FAST_MODEL } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import type { Db } from '@/db/client';

export type VerifierDeps = { db: Db; model?: LanguageModel };
export type VerifierInput = {
  churchId: string;
  documentId: string;
  text: string;
  events: ExtractedEvent[];
};

export type Verdict = { decision: 'confirmed' | 'rejected'; note: string };
export type VerifiedEvent = ExtractedEvent & { verdict: Verdict };

const verdictSchema = z.object({
  decision: z.enum(['confirmed', 'rejected']),
  note: z.string().describe('Uma frase em português explicando a decisão'),
});

// The verifier is deliberately a SEPARATE call with a separate prompt, not a second
// pass by the extractor: it is given the candidate and the source and asked to disprove
// the candidate. An extractor asked to check itself tends to agree with itself.
const SYSTEM = [
  'You audit a single candidate calendar event against the church document it was extracted from.',
  'Confirm ONLY if the document genuinely supports the title, the date, and the time. Anything the document does not state — an invented location, a shifted date, a plausible-sounding detail — means reject.',
  'Treat the candidate as a claim to be disproved, not as a summary to be agreed with.',
  'Answer with a decision and one short sentence in Portuguese explaining why.',
].join('\n');

export async function verifyEvents(
  deps: VerifierDeps,
  input: VerifierInput,
): Promise<VerifiedEvent[]> {
  if (input.events.length === 0) return [];

  return Promise.all(
    input.events.map(async (event): Promise<VerifiedEvent> => {
      try {
        const { object, usage } = await generateObject({
          model: deps.model ?? FAST_MODEL,
          schema: verdictSchema,
          system: SYSTEM,
          prompt: [
            'DOCUMENTO:', input.text, '',
            'EVENTO CANDIDATO:', JSON.stringify(
              {
                title: event.title, startsAt: event.startsAt,
                location: event.location, description: event.description,
                sourceQuote: event.sourceQuote,
              }, null, 2,
            ),
          ].join('\n'),
        });

        try {
          await recordUsage(deps.db, {
            churchId: input.churchId,
            feature: 'ingest.verify',
            model: FAST_MODEL,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
          });
        } catch (error) {
          console.error('ingest.verify usage not recorded', {
            churchId: input.churchId, documentId: input.documentId, error,
          });
        }

        return { ...event, verdict: object };
      } catch (error) {
        // Fail closed: an unverified event is never published. A verification outage
        // must not become a silent path for unchecked data into the calendar.
        console.error('ingest.verify failed; rejecting candidate', {
          churchId: input.churchId, documentId: input.documentId, title: event.title, error,
        });
        return {
          ...event,
          verdict: { decision: 'rejected', note: 'A verificação automática falhou; evento não publicado.' },
        };
      }
    }),
  );
}
```

- [ ] **Step 4: Run tests, full suite, typecheck**

Run: `npx vitest run tests/agent/verifier.test.ts && npm test && npm run typecheck`
Expected: 3 new tests pass; suite green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ingest): verifier agent that fails closed on unverified events"
```

---

### Task 5: Ingest pipeline orchestration

**Files:**
- Create: `src/core/ingest.ts`, `src/db/repo/documents.ts`, `tests/core/ingest.test.ts`

**Interfaces:**
- Consumes: everything above, plus `chunkMarkdown`, `Embedder`, `recordUsage`, `createEvent`.
- Produces:
  - `@/db/repo/documents`: `createDocument(db, { churchId, title, kind, sourcePath? })`, `getDocument(db, churchId, documentId)`, `setIngestStatus(db, churchId, documentId, status, opts?)` (validates the transition), `saveSourceText(db, churchId, documentId, text)`, `listDocuments(db, churchId)`.
  - `@/core/ingest`: `type IngestResult = { documentId: string; status: IngestStatus; chunkCount: number; extracted: number; published: number; rejected: number }`, `runIngest(deps, input): Promise<IngestResult>` where `deps = { db, embedder, extractorModel?, verifierModel? }` and `input = { churchId, documentId, bytes, mimeType, referenceDate? }`.

- [ ] **Step 1: Write `src/db/repo/documents.ts`**

```ts
import { and, desc, eq } from 'drizzle-orm';
import { assertTransition, type IngestStatus } from '@/core/ingest-status';
import type { Db } from '@/db/client';
import { documents } from '@/db/schema';

export async function createDocument(
  db: Db,
  input: { churchId: string; title: string; kind: string; sourcePath?: string },
) {
  const [row] = await db
    .insert(documents)
    .values({ ...input, ingestStatus: 'uploaded' })
    .returning();
  return row;
}

export async function getDocument(db: Db, churchId: string, documentId: string) {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.churchId, churchId), eq(documents.id, documentId)));
  return row;
}

export async function listDocuments(db: Db, churchId: string) {
  return db
    .select()
    .from(documents)
    .where(eq(documents.churchId, churchId))
    .orderBy(desc(documents.createdAt));
}

export async function saveSourceText(db: Db, churchId: string, documentId: string, text: string) {
  await db
    .update(documents)
    .set({ sourceText: text })
    .where(and(eq(documents.churchId, churchId), eq(documents.id, documentId)));
}

/**
 * Moves a document to `status`, refusing an illegal transition. Reads the current row
 * first so the state machine — not the caller — decides what is allowed.
 */
export async function setIngestStatus(
  db: Db,
  churchId: string,
  documentId: string,
  status: IngestStatus,
  opts: { error?: string | null } = {},
) {
  const current = await getDocument(db, churchId, documentId);
  if (!current) throw new Error(`Document ${documentId} not found for church ${churchId}`);
  assertTransition(current.ingestStatus as IngestStatus, status);
  await db
    .update(documents)
    .set({ ingestStatus: status, ingestError: opts.error ?? null })
    .where(and(eq(documents.churchId, churchId), eq(documents.id, documentId)));
}
```

- [ ] **Step 2: Write the failing test `tests/core/ingest.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { runIngest } from '@/core/ingest';
import { createDocument, getDocument } from '@/db/repo/documents';
import { listUpcomingEvents } from '@/db/repo/events';
import { chunks, events, usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

const DOC = [
  '# Boletim de Outubro',
  '',
  '## Encontro de jovens OTB — 10/10 (sábado)',
  '',
  'Às 19h, na quadra coberta.',
  '',
  '## Noite de louvor — 31/10 (sábado)',
  '',
  'Com o coral, às 19h30.',
].join('\n');

const bytes = () => new TextEncoder().encode(DOC);

async function objectModel(payloads: unknown[]) {
  const { MockLanguageModelV3 } = await import('ai/test');
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 100, noCache: 100 }, outputTokens: { total: 30, text: 30 } },
      content: [{ type: 'text', text: JSON.stringify(payloads[Math.min(call++, payloads.length - 1)]) }],
      warnings: [],
    }),
  });
}

const TWO_CANDIDATES = {
  events: [
    { title: 'Encontro de jovens OTB', startsAt: '2026-10-10T22:00:00Z', location: 'Quadra coberta',
      description: null, confidence: 0.9, sourceQuote: 'Encontro de jovens OTB — 10/10 (sábado)' },
    { title: 'Noite de louvor', startsAt: '2026-10-31T22:30:00Z', location: null,
      description: null, confidence: 0.8, sourceQuote: 'Noite de louvor — 31/10 (sábado)' },
  ],
};

describe('runIngest', () => {
  it('parses, chunks, embeds, extracts, verifies and publishes', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });

    const result = await runIngest(
      {
        db,
        embedder: new HashEmbedder(),
        extractorModel: await objectModel([TWO_CANDIDATES]),
        verifierModel: await objectModel([
          { decision: 'confirmed', note: 'Confere.' },
          { decision: 'rejected', note: 'Nao confere.' },
        ]),
      },
      { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' },
    );

    expect(result.status).toBe('published');
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.extracted).toBe(2);
    expect(result.published + result.rejected).toBe(2);

    // Only confirmed events reach the calendar, and they carry their provenance.
    const stored = await db.select().from(events);
    expect(stored).toHaveLength(result.published);
    for (const e of stored) {
      expect(e.verified).toBe(true);
      expect(e.sourceDocumentId).toBe(doc.id);
      expect(e.sourceQuote).toBeTruthy();
    }

    // Chunks are searchable and tenant-scoped.
    const storedChunks = await db.select().from(chunks);
    expect(storedChunks.length).toBe(result.chunkCount);
    expect(storedChunks.every((c) => c.churchId === church.id)).toBe(true);

    // The document ends in a terminal state with its parsed text retained.
    const after = await getDocument(db, church.id, doc.id);
    expect(after.ingestStatus).toBe('published');
    expect(after.sourceText).toContain('Encontro de jovens');
    expect(after.ingestError).toBeNull();

    // Both agent stages were metered.
    const ledger = await db.select().from(usageLedger);
    expect(ledger.some((u) => u.feature === 'ingest.extract')).toBe(true);
    expect(ledger.some((u) => u.feature === 'ingest.verify')).toBe(true);
  });

  it('publishes no events when every candidate is rejected, but still publishes the document', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });

    const result = await runIngest(
      {
        db, embedder: new HashEmbedder(),
        extractorModel: await objectModel([TWO_CANDIDATES]),
        verifierModel: await objectModel([{ decision: 'rejected', note: 'Nao confere.' }]),
      },
      { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' },
    );

    expect(result.published).toBe(0);
    expect(result.rejected).toBe(2);
    expect(result.status).toBe('published');
    expect(await listUpcomingEvents(db, church.id, 10, new Date('2026-10-01'))).toHaveLength(0);
    // Retrieval still works even when extraction yields nothing.
    expect((await db.select().from(chunks)).length).toBeGreaterThan(0);
  });

  it('marks the document failed and records the reason when parsing fails', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Imagem', kind: 'upload' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runIngest(
      { db, embedder: new HashEmbedder() },
      { churchId: church.id, documentId: doc.id, bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
    );

    expect(result.status).toBe('failed');
    const after = await getDocument(db, church.id, doc.id);
    expect(after.ingestStatus).toBe('failed');
    expect(after.ingestError).toMatch(/image\/png/);
    expect(await db.select().from(chunks)).toHaveLength(0);
    spy.mockRestore();
  });

  it('re-ingesting replaces the previous chunks instead of duplicating them', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });
    const deps = () => ({
      db, embedder: new HashEmbedder(),
      extractorModel: undefined, verifierModel: undefined,
    });
    const input = { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' };

    const first = await runIngest({ ...deps(), extractorModel: undefined }, input);
    const countAfterFirst = (await db.select().from(chunks)).length;
    expect(countAfterFirst).toBe(first.chunkCount);

    // A published document is re-ingested as a fresh run; chunks must not accumulate.
    const second = await runIngest({ ...deps() }, input);
    expect(second.status).toBe('published');
    expect((await db.select().from(chunks)).length).toBe(second.chunkCount);
  });

  it('never touches another tenant’s data', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const docB = await createDocument(db, { churchId: b.id, title: 'B', kind: 'bulletin' });

    await expect(
      runIngest({ db, embedder: new HashEmbedder() },
        { churchId: a.id, documentId: docB.id, bytes: bytes(), mimeType: 'text/markdown' }),
    ).rejects.toThrow(/not found/i);
  });
});
```

Note the fourth test passes `extractorModel: undefined` — with no extractor model configured the pipeline must skip the agent stages rather than call a real gateway. Implement that explicitly in Step 3.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run tests/core/ingest.test.ts`
Expected: FAIL — cannot resolve `@/core/ingest`.

- [ ] **Step 4: Write `src/core/ingest.ts`**

```ts
import { and, eq, inArray } from 'drizzle-orm';
import type { LanguageModel } from 'ai';
import { extractEvents } from '@/agent/extractor';
import { verifyEvents } from '@/agent/verifier';
import type { Embedder } from '@/ai/embedder';
import { recordUsage } from '@/ai/usage';
import { chunkMarkdown } from '@/core/chunking';
import type { IngestStatus } from '@/core/ingest-status';
import { parseDocument } from '@/core/parse-document';
import type { Db } from '@/db/client';
import { getDocument, saveSourceText, setIngestStatus } from '@/db/repo/documents';
import { chunks, events } from '@/db/schema';

export type IngestDeps = {
  db: Db;
  embedder: Embedder;
  /** Omit to skip the agent stages entirely (used by tests and by text-only re-indexing). */
  extractorModel?: LanguageModel;
  verifierModel?: LanguageModel;
};

export type IngestInput = {
  churchId: string;
  documentId: string;
  bytes: Uint8Array;
  mimeType: string;
  /** Defaults to today; the extractor uses it to resolve relative dates. */
  referenceDate?: string;
};

export type IngestResult = {
  documentId: string;
  status: IngestStatus;
  chunkCount: number;
  extracted: number;
  published: number;
  rejected: number;
};

/**
 * Runs one document through the pipeline. Deterministic stages (parse → chunk → embed)
 * come first so the knowledge base is correct even when the agent stages find nothing;
 * the extractor/verifier pair then decides what, if anything, reaches the calendar.
 * Every stage moves the document through `ingest_status`, so a crashed run is always
 * visibly parked in a known state.
 */
export async function runIngest(deps: IngestDeps, input: IngestInput): Promise<IngestResult> {
  const { db, embedder } = deps;
  const { churchId, documentId } = input;

  const doc = await getDocument(db, churchId, documentId);
  if (!doc) throw new Error(`Document ${documentId} not found for church ${churchId}`);

  const result: IngestResult = {
    documentId, status: doc.ingestStatus as IngestStatus,
    chunkCount: 0, extracted: 0, published: 0, rejected: 0,
  };

  try {
    await setIngestStatus(db, churchId, documentId, 'parsing');
    result.status = 'parsing';

    const parsed = await parseDocument(input.bytes, input.mimeType);
    await saveSourceText(db, churchId, documentId, parsed.text);

    // Re-ingest is a replace, not an append: drop this document's previous chunks and
    // its previously extracted events before writing new ones.
    await db.delete(chunks).where(and(eq(chunks.churchId, churchId), eq(chunks.documentId, documentId)));
    await db.delete(events).where(and(eq(events.churchId, churchId), eq(events.sourceDocumentId, documentId)));

    const pieces = chunkMarkdown(parsed.text);
    if (pieces.length > 0) {
      const { embeddings, tokens } = await embedder.embed(pieces.map((p) => p.content));
      await db.insert(chunks).values(
        pieces.map((piece, i) => ({
          churchId, documentId, seq: piece.seq, content: piece.content, embedding: embeddings[i],
        })),
      );
      result.chunkCount = pieces.length;
      if (tokens > 0) {
        try {
          await recordUsage(db, {
            churchId, feature: 'ingest.embed', model: embedder.model,
            inputTokens: tokens, outputTokens: 0,
          });
        } catch (error) {
          console.error('ingest.embed usage not recorded', { churchId, documentId, error });
        }
      }
    }

    await setIngestStatus(db, churchId, documentId, 'extracting');
    result.status = 'extracting';

    const referenceDate = input.referenceDate ?? new Date().toISOString().slice(0, 10);
    const candidates = deps.extractorModel
      ? await extractEvents(
          { db, model: deps.extractorModel },
          { churchId, documentId, text: parsed.text, referenceDate },
        )
      : [];
    result.extracted = candidates.length;

    await setIngestStatus(db, churchId, documentId, 'verifying');
    result.status = 'verifying';

    const verified = candidates.length
      ? await verifyEvents(
          { db, model: deps.verifierModel },
          { churchId, documentId, text: parsed.text, events: candidates },
        )
      : [];

    const confirmed = verified.filter((e) => e.verdict.decision === 'confirmed');
    result.published = confirmed.length;
    result.rejected = verified.length - confirmed.length;

    if (confirmed.length > 0) {
      await db.insert(events).values(
        confirmed.map((e) => ({
          churchId,
          title: e.title,
          startsAt: new Date(e.startsAt),
          location: e.location,
          description: e.description,
          verified: true,
          sourceDocumentId: documentId,
          extractionConfidence: e.confidence,
          verificationNote: e.verdict.note,
          sourceQuote: e.sourceQuote,
        })),
      );
    }

    await setIngestStatus(db, churchId, documentId, 'published');
    result.status = 'published';
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('ingest failed', { churchId, documentId, error });
    try {
      const current = await getDocument(db, churchId, documentId);
      if (current && current.ingestStatus !== 'published') {
        await setIngestStatus(db, churchId, documentId, 'failed', { error: message });
      }
    } catch (statusError) {
      console.error('could not mark document failed', { churchId, documentId, statusError });
    }
    result.status = 'failed';
    return result;
  }
}
```

Note the tenant test expects `runIngest` to REJECT (throw) when the document belongs to another church — the `getDocument` guard runs before the try/catch, so that throw propagates. Keep it that way: a cross-tenant call is a programming error, not a document-level failure to record.

- [ ] **Step 5: Run tests, full suite, typecheck, lint**

Run: `npx vitest run tests/core/ingest.test.ts && npm test && npm run typecheck && npx eslint src tests scripts`
Expected: 5 new tests pass; suite green; clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ingest): orchestrate parse, embed, extract and verify into one pipeline"
```

---

### Task 6: Ingest API route

**Files:**
- Create: `src/app/api/ingest/route.ts`, `src/channels/ingest-http.ts`, `tests/channels/ingest-http.test.ts`

**Interfaces:**
- Consumes: `runIngest`, `createDocument`, `getChurchBySlug`, `checkRateLimit`, `checkBudget`.
- Produces: `handleIngestRequest(deps, req): Promise<Response>` from `@/channels/ingest-http`. HTTP contract: `POST` multipart/form-data with fields `file` (the document) and `title`; responds `201` with the `IngestResult` JSON, `400` bad request, `413` file too large, `415` unsupported media type, `429` rate limited, `402` budget exhausted.

**Access note:** Plan 1 has no staff authentication and Plan 3 owns the dashboard and its auth. This route is therefore gated by a shared secret in `INGEST_TOKEN` (an `Authorization: Bearer` header) — a deliberate placeholder so a public deployment cannot be used as free document processing. Requests without a valid token get `401`. Record this in the brain.

- [ ] **Step 1: Write the failing test `tests/channels/ingest-http.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { handleIngestRequest } from '@/channels/ingest-http';
import { budgets, chunks, churches, documents } from '@/db/schema';
import { createTestDb } from '../helpers/db';

const TOKEN = 'test-ingest-token';

async function setupDemo() {
  const db = await createTestDb();
  const [church] = await db.insert(churches).values({ slug: 'demo', name: 'Igreja da Colina' }).returning();
  await db.insert(budgets).values({ churchId: church.id, monthlyUsd: 40 });
  return { db, church };
}

function deps(db: unknown, over: Record<string, unknown> = {}) {
  return { db, embedder: new HashEmbedder(), globalCapUsd: 50, ingestToken: TOKEN, ...over } as never;
}

function ingestReq(body: FormData, opts: { token?: string | null } = {}) {
  const headers = new Headers();
  const token = opts.token === undefined ? TOKEN : opts.token;
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('http://test/api/ingest', { method: 'POST', headers, body });
}

function form(text: string, name = 'boletim.md', type = 'text/markdown', title = 'Boletim') {
  const fd = new FormData();
  fd.set('file', new File([text], name, { type }));
  fd.set('title', title);
  return fd;
}

describe('handleIngestRequest', () => {
  it('rejects a request with no token', async () => {
    const { db } = await setupDemo();
    const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.'), { token: null }));
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const { db } = await setupDemo();
    const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.'), { token: 'nope' }));
    expect(res.status).toBe(401);
  });

  it('rejects a request with no file', async () => {
    const { db } = await setupDemo();
    const fd = new FormData();
    fd.set('title', 'Sem arquivo');
    const res = await handleIngestRequest(deps(db), ingestReq(fd));
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported media type with 415 and persists nothing', async () => {
    const { db } = await setupDemo();
    const res = await handleIngestRequest(
      deps(db), ingestReq(form('binary', 'x.png', 'image/png')),
    );
    expect(res.status).toBe(415);
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  it('rejects an oversized file with 413', async () => {
    const { db } = await setupDemo();
    const big = 'a'.repeat(6 * 1024 * 1024);
    const res = await handleIngestRequest(deps(db), ingestReq(form(big)));
    expect(res.status).toBe(413);
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  it('ingests a markdown document and reports the result', async () => {
    const { db } = await setupDemo();
    const res = await handleIngestRequest(
      deps(db), ingestReq(form('# Boletim\n\n## Culto\n\nDomingo às 10h.')),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('published');
    expect(body.chunkCount).toBeGreaterThan(0);
    expect((await db.select().from(documents))[0].title).toBe('Boletim');
    expect((await db.select().from(chunks)).length).toBe(body.chunkCount);
  });

  it('returns 402 when the budget is exhausted, without creating a document', async () => {
    const { db } = await setupDemo();
    const res = await handleIngestRequest(
      deps(db, { globalCapUsd: 0 }), ingestReq(form('# Doc\n\nTexto.')),
    );
    expect(res.status).toBe(402);
    expect(await db.select().from(documents)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/channels/ingest-http.test.ts`
Expected: FAIL — cannot resolve `@/channels/ingest-http`.

- [ ] **Step 3: Write `src/channels/ingest-http.ts`**

```ts
import type { LanguageModel } from 'ai';
import { checkBudget } from '@/ai/usage';
import type { Embedder } from '@/ai/embedder';
import { runIngest } from '@/core/ingest';
import { UnsupportedMediaTypeError } from '@/core/parse-document';
import { checkRateLimit } from '@/core/rate-limit';
import type { Db } from '@/db/client';
import { DEMO_CHURCH_SLUG, getChurchBySlug } from '@/db/repo/churches';
import { createDocument } from '@/db/repo/documents';

export type IngestChannelDeps = {
  db: Db;
  embedder: Embedder;
  globalCapUsd: number;
  /** Shared secret standing in for staff auth until Plan 3 ships the dashboard. */
  ingestToken: string | undefined;
  extractorModel?: LanguageModel;
  verifierModel?: LanguageModel;
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const INGEST_LIMIT = { limit: 10, windowSeconds: 3600 };

export async function handleIngestRequest(deps: IngestChannelDeps, req: Request): Promise<Response> {
  // Without a configured token the endpoint is closed, not open: an unset secret must
  // never mean "anyone may ingest".
  const expected = deps.ingestToken;
  const presented = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !presented || presented !== expected) {
    return Response.json({ code: 'unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ code: 'bad_request' }, { status: 400 });
  }

  const file = form.get('file');
  const title = String(form.get('title') ?? '').trim();
  if (!(file instanceof File) || !title) {
    return Response.json({ code: 'bad_request' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ code: 'file_too_large' }, { status: 413 });
  }

  const church = await getChurchBySlug(deps.db, DEMO_CHURCH_SLUG);
  if (!church) return Response.json({ code: 'not_seeded' }, { status: 500 });

  const rate = await checkRateLimit(deps.db, `ingest:${church.id}`, INGEST_LIMIT);
  if (!rate.allowed) return Response.json({ code: 'rate_limited' }, { status: 429 });

  const budget = await checkBudget(deps.db, church.id, deps.globalCapUsd);
  if (!budget.allowed) {
    return Response.json({ code: 'budget_exhausted', reason: budget.reason }, { status: 402 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';

  // Fail on an unsupported type BEFORE creating the document row, so a rejected upload
  // leaves no orphan record behind.
  try {
    const { parseDocument } = await import('@/core/parse-document');
    await parseDocument(bytes, mimeType);
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) {
      return Response.json({ code: 'unsupported_media_type' }, { status: 415 });
    }
    return Response.json({ code: 'bad_request' }, { status: 400 });
  }

  const doc = await createDocument(deps.db, {
    churchId: church.id, title, kind: 'upload', sourcePath: file.name,
  });

  const result = await runIngest(
    {
      db: deps.db, embedder: deps.embedder,
      extractorModel: deps.extractorModel, verifierModel: deps.verifierModel,
    },
    { churchId: church.id, documentId: doc.id, bytes, mimeType },
  );

  return Response.json(result, { status: 201 });
}
```

Parsing twice (once to validate, once inside the pipeline) is deliberate and cheap for demo-sized documents; it keeps the "no orphan row" guarantee simple. Note it in the file if you keep it.

- [ ] **Step 4: Write `src/app/api/ingest/route.ts`**

```ts
import { GatewayEmbedder } from '@/ai/embedder';
import { FAST_MODEL } from '@/ai/pricing';
import { handleIngestRequest } from '@/channels/ingest-http';
import { getDb } from '@/db/client';

export const maxDuration = 300;

export async function POST(req: Request) {
  return handleIngestRequest(
    {
      db: getDb(),
      embedder: new GatewayEmbedder(),
      globalCapUsd: Number(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP ?? '50'),
      ingestToken: process.env.INGEST_TOKEN,
      extractorModel: FAST_MODEL,
      verifierModel: FAST_MODEL,
    },
    req,
  );
}
```

Reuse the same validated-cap helper the chat route uses rather than duplicating `Number(...)` — if that helper is not exported, export it and import it here.

- [ ] **Step 5: Add `INGEST_TOKEN` to `.env.example`**

```bash
# Shared secret for POST /api/ingest (staff-only until Plan 3 ships real auth).
# Generate one with: openssl rand -hex 32
INGEST_TOKEN=
```

- [ ] **Step 6: Run tests, full suite, typecheck, lint, build**

Run: `npx vitest run tests/channels/ingest-http.test.ts && npm test && npm run typecheck && npx eslint src tests scripts && npm run build`
Expected: 7 new tests pass; everything green.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(ingest): token-gated ingest endpoint"
```

---

### Task 7: End-to-end pipeline test on a realistic bulletin, and brain update

**Files:**
- Create: `tests/e2e/ingest-to-answer.test.ts`
- Modify: `brain/status.md`, `brain/log/decisions.md`

**Interfaces:**
- Consumes: everything.
- Produces: proof that an ingested document is answerable by the chat agent, and a brain that reflects Plan 2.

- [ ] **Step 1: Write `tests/e2e/ingest-to-answer.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { secretaryTools } from '@/agent/secretary';
import { HashEmbedder } from '@/ai/embedder';
import { runIngest } from '@/core/ingest';
import { ensureConversation } from '@/db/repo/chat';
import { createDocument } from '@/db/repo/documents';
import { churches } from '@/db/schema';
import { createTestDb } from '../helpers/db';

const BULLETIN = [
  '# Boletim Informativo — Novembro de 2026',
  '',
  '> Igreja da Colina — igreja fictícia, criada para demonstração.',
  '',
  '## Ceia de Natal da igreja — 20/12 (domingo)',
  '',
  'A ceia de Natal acontece no dia 20/12, às 19h, no salão comunitário.',
  'Inscrições com a secretaria até 13/12.',
].join('\n');

async function objectModel(payloads: unknown[]) {
  const { MockLanguageModelV3 } = await import('ai/test');
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 100, noCache: 100 }, outputTokens: { total: 30, text: 30 } },
      content: [{ type: 'text', text: JSON.stringify(payloads[Math.min(call++, payloads.length - 1)]) }],
      warnings: [],
    }),
  });
}

describe('ingest → answer', () => {
  it('a freshly ingested bulletin is retrievable by the secretary and its event reaches the calendar', async () => {
    const db = await createTestDb();
    const [church] = await db.insert(churches).values({ slug: 'demo', name: 'Igreja da Colina' }).returning();
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim de Novembro', kind: 'bulletin' });

    const result = await runIngest(
      {
        db,
        embedder: new HashEmbedder(),
        extractorModel: await objectModel([{
          events: [{
            title: 'Ceia de Natal da igreja',
            startsAt: '2026-12-20T22:00:00Z',
            location: 'Salão comunitário',
            description: 'Inscrições até 13/12',
            confidence: 0.95,
            sourceQuote: 'Ceia de Natal da igreja — 20/12 (domingo)',
          }],
        }]),
        verifierModel: await objectModel([{ decision: 'confirmed', note: 'Data e local conferem.' }]),
      },
      {
        churchId: church.id, documentId: doc.id,
        bytes: new TextEncoder().encode(BULLETIN), mimeType: 'text/markdown',
        referenceDate: '2026-11-01',
      },
    );

    expect(result.status).toBe('published');
    expect(result.published).toBe(1);

    const conversationId = crypto.randomUUID();
    await ensureConversation(db, { id: conversationId, churchId: church.id, visitorKey: 'e2e' });
    const tools = secretaryTools(
      { db, embedder: new HashEmbedder() },
      { churchId: church.id, conversationId },
    );

    // The knowledge base answers from the newly ingested document...
    const search = await tools.searchKnowledge.execute!({ query: 'quando é a ceia de natal?' }, {} as never);
    expect(search.sources.length).toBeGreaterThan(0);
    expect(search.sources[0].documentTitle).toBe('Boletim de Novembro');
    expect(search.sources[0].excerpt).toContain('20/12');

    // ...and the verified event is on the calendar the agent reads.
    const calendar = await tools.getCalendar.execute!({}, {} as never);
    const titles = calendar.events.map((e: { title: string }) => e.title);
    expect(titles).toContain('Ceia de Natal da igreja');
  });
});
```

If `listUpcomingEvents` filters on `now` and the fixture date is in the past relative to the test run, pass an explicit `now` or choose a date safely in the future — do not weaken the assertion.

- [ ] **Step 2: Run it, then the full suite**

Run: `npx vitest run tests/e2e/ingest-to-answer.test.ts && npm test && npm run typecheck && npx eslint src tests scripts`
Expected: green.

- [ ] **Step 3: Update the brain**

In `brain/status.md`, add Plan 2 to what runs today (ingest pipeline, its status machine, the extractor/verifier pair, the token-gated endpoint) and note that `INGEST_TOKEN` must be set in production.

In `brain/log/decisions.md`, append a dated section recording: why the verifier is a separate call with a disprove-it prompt rather than a second extractor pass; why the pipeline fails closed on verification failure; why deterministic quote/date guards run before the verifier; why re-ingest replaces rather than appends; and why the ingest endpoint is token-gated as a placeholder for Plan 3's auth.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(ingest): prove an ingested bulletin becomes an answerable, cited source"
```

---

## Self-Review Notes

- **Spec coverage (Plan 2 scope):** Document Processing (Tasks 2, 5), AI Data Extraction (3, 5), Multi-Agent Systems (3+4 as extractor→verifier, 5 orchestration), AI Workflow Automation (5, 6 — upload triggers the pipeline). Knowledge-base growth via ingest (5). Metering of both agent stages (3, 4, 5). Staff UI for all of this is Plan 3, reporting is Plan 4 — deliberately out of scope here.
- **Deliberately not built:** Vercel Blob storage of the original file (the parsed text is retained in `documents.source_text`, which is what every later stage needs; storing the original binary is Plan 3's concern when the dashboard offers downloads), background/queued execution (the endpoint runs the pipeline inline with `maxDuration = 300`, honest at demo scale), and real staff auth.
- **Known API-surface risks, flagged inline:** `unpdf`'s export names/result shape (Task 2), `generateObject`'s mock-model contract in ai@7.0.68 (Tasks 3, 4). Each instructs consulting the installed type definitions rather than guessing.
- **Cost note:** verification is one model call per candidate event. For a bulletin with five events that is six `FAST_MODEL` calls per ingest — a few tenths of a cent. The endpoint's own rate limit (10/hour) bounds it.
