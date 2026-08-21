# Plan 3: Staff Operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Church staff can log in and actually run the thing: manage the knowledge base (upload documents, watch them ingest), work the prayer and support inboxes with an AI-drafted reply they edit before sending, see the extracted calendar, and watch what the AI is costing them.

**Architecture:** A password-gated staff session (signed, httpOnly cookie) guards a `/staff` area rendered by server components reading through the existing repos. Mutations are Server Actions that call the same core functions the API routes use — no parallel logic. The support inbox adds one new agent call: a **reply drafter** that proposes a Portuguese reply grounded in the knowledge base, which a human edits and sends. The staff session retires `INGEST_TOKEN`, which Plan 2 shipped as an explicit placeholder for exactly this.

**Tech Stack:** Existing (Next.js App Router server components + Server Actions, Neon + pgvector, Drizzle, AI SDK v6 via Vercel AI Gateway, Vitest, Tailwind). No new dependencies — session signing uses Node's `crypto` HMAC.

This is **Plan 3 of 4**. Plans 1 (chat slice) and 2 (ingest pipeline) are merged. Plan 4 is reporting + the portfolio landing page. Spec: `docs/superpowers/specs/2026-08-18-churchchatbox-v2-design.md`.

## Global Constraints

- Every table carries `church_id`; every query is tenant-scoped. No exceptions.
- Every LLM/embedding call recorded in `usage_ledger`; background/staff-side agent work uses `FAST_MODEL`; model constants live in `src/ai/pricing.ts` only.
- A ledger-write failure must never destroy work that already succeeded (log and carry on).
- Node runtime only — never `runtime = 'edge'`.
- Public repo: no secrets, no `.env*` committed, fictional data only.
- Budget/rate limits apply to staff actions too: an authenticated session is not a licence to spend without a cap.
- Code, comments, docs: English. Staff UI copy: Portuguese (staff are Brazilian church workers), with the fictional-demo disclaimer visible.
- Tests run offline against PGlite with mock models. No network, no API key.

---

### Task 1: Staff session (sign in, sign out, guard)

**Files:**
- Create: `src/core/staff-session.ts`, `tests/core/staff-session.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces from `@/core/staff-session`:
  - `STAFF_COOKIE_NAME = 'ccb_staff'`
  - `signSession(payload: StaffSession, secret: string): string` and `verifySession(token: string, secret: string, now?: Date): StaffSession | null`, where `type StaffSession = { churchId: string; issuedAt: number; expiresAt: number }`
  - `checkStaffPassword(presented: string | undefined, expected: string | undefined): boolean` — timing-safe, fails closed when `expected` is unset/empty
  - `SESSION_TTL_SECONDS = 60 * 60 * 8`

- [ ] **Step 1: Write the failing test `tests/core/staff-session.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  checkStaffPassword, SESSION_TTL_SECONDS, signSession, verifySession, type StaffSession,
} from '@/core/staff-session';

const SECRET = 'test-secret-value';
const churchId = '11111111-1111-1111-1111-111111111111';

function session(now = new Date('2026-08-20T12:00:00Z')): StaffSession {
  return {
    churchId,
    issuedAt: now.getTime(),
    expiresAt: now.getTime() + SESSION_TTL_SECONDS * 1000,
  };
}

describe('checkStaffPassword', () => {
  it('fails closed when no password is configured', () => {
    expect(checkStaffPassword('anything', undefined)).toBe(false);
    expect(checkStaffPassword('anything', '')).toBe(false);
    expect(checkStaffPassword(undefined, undefined)).toBe(false);
  });

  it('rejects a wrong password and accepts the right one', () => {
    expect(checkStaffPassword('wrong', 'correct-horse')).toBe(false);
    expect(checkStaffPassword('correct-horse', 'correct-horse')).toBe(true);
  });

  it('rejects without throwing when lengths differ, including multibyte', () => {
    expect(checkStaffPassword('short', 'a-much-longer-password')).toBe(false);
    expect(checkStaffPassword('ééééé', 'aaaaa')).toBe(false);
  });

  it('rejects a missing presented password', () => {
    expect(checkStaffPassword(undefined, 'correct-horse')).toBe(false);
    expect(checkStaffPassword('', 'correct-horse')).toBe(false);
  });
});

describe('session signing', () => {
  it('round-trips a valid session', () => {
    const s = session();
    const verified = verifySession(signSession(s, SECRET), SECRET, new Date('2026-08-20T13:00:00Z'));
    expect(verified).toEqual(s);
  });

  it('rejects a token signed with a different secret', () => {
    expect(verifySession(signSession(session(), SECRET), 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signSession(session(), SECRET);
    const [payload, sig] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    decoded.churchId = '22222222-2222-2222-2222-222222222222';
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${sig}`;
    expect(verifySession(forged, SECRET)).toBeNull();
  });

  it('rejects an expired session', () => {
    const s = session();
    const token = signSession(s, SECRET);
    expect(verifySession(token, SECRET, new Date('2026-08-21T12:00:00Z'))).toBeNull();
  });

  it('rejects malformed tokens without throwing', () => {
    for (const bad of ['', 'nodot', 'a.b.c', '.', 'x.', '.y', 'not-base64!.sig']) {
      expect(verifySession(bad, SECRET)).toBeNull();
    }
  });

  it('fails closed when the secret is empty', () => {
    expect(verifySession(signSession(session(), SECRET), '')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/core/staff-session.test.ts`
Expected: FAIL — cannot resolve `@/core/staff-session`.

- [ ] **Step 3: Write `src/core/staff-session.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export const STAFF_COOKIE_NAME = 'ccb_staff';
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type StaffSession = {
  churchId: string;
  issuedAt: number;
  expiresAt: number;
};

/**
 * Constant-time password check that fails CLOSED: an unset or empty configured password
 * means nobody may sign in, never everybody. Compares byte length first so
 * `timingSafeEqual` cannot throw on a length mismatch (including multibyte input).
 */
export function checkStaffPassword(
  presented: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected || !presented) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signSession(payload: StaffSession, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${hmac(body, secret)}`;
}

/**
 * Returns the session only when the signature verifies AND it has not expired.
 * Any malformed input returns null rather than throwing — this parses attacker-controlled
 * cookie values.
 */
export function verifySession(
  token: string,
  secret: string,
  now: Date = new Date(),
): StaffSession | null {
  if (!secret || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = hmac(body, secret);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StaffSession;
    if (typeof parsed?.churchId !== 'string' || typeof parsed?.expiresAt !== 'number') return null;
    if (parsed.expiresAt <= now.getTime()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hmac(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}
```

- [ ] **Step 4: Add the env vars to `.env.example`**

```bash
# Staff area (POST /staff/login). Fails closed when unset — nobody can sign in.
STAFF_PASSWORD=
# Secret used to sign the staff session cookie. Generate: openssl rand -hex 32
STAFF_SESSION_SECRET=
```

- [ ] **Step 5: Run tests, full suite, typecheck, lint**

Run: `npx vitest run tests/core/staff-session.test.ts && npm test && npm run typecheck && npx eslint src tests scripts`
Expected: 11 new tests pass; suite green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(staff): signed, fail-closed staff session primitives"
```

---

### Task 2: Staff auth wiring — login page, logout, and a server-side guard

**Files:**
- Create: `src/core/staff-auth.ts`, `src/app/staff/login/page.tsx`, `src/app/staff/login/actions.ts`, `src/app/staff/layout.tsx`, `tests/core/staff-auth.test.ts`

**Interfaces:**
- Produces from `@/core/staff-auth`:
  - `type StaffContext = { churchId: string; churchName: string }`
  - `readStaffSession(cookieValue: string | undefined, secret: string | undefined, now?: Date): StaffSession | null` — a thin, testable wrapper that tolerates missing config
  - `staffCookieOptions(maxAgeSeconds: number)` returning the cookie attribute object used for both set and clear
- The login Server Action `signIn(formData)` and `signOut()`; `src/app/staff/layout.tsx` redirects to `/staff/login` when there is no valid session.

- [ ] **Step 1: Write the failing test `tests/core/staff-auth.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { readStaffSession, staffCookieOptions } from '@/core/staff-auth';
import { SESSION_TTL_SECONDS, signSession } from '@/core/staff-session';

const SECRET = 'a-secret';
const churchId = '11111111-1111-1111-1111-111111111111';
const now = new Date('2026-08-20T12:00:00Z');
const valid = () =>
  signSession(
    { churchId, issuedAt: now.getTime(), expiresAt: now.getTime() + SESSION_TTL_SECONDS * 1000 },
    SECRET,
  );

describe('readStaffSession', () => {
  it('returns the session for a valid cookie', () => {
    expect(readStaffSession(valid(), SECRET, now)?.churchId).toBe(churchId);
  });

  it('returns null when the cookie is absent', () => {
    expect(readStaffSession(undefined, SECRET, now)).toBeNull();
  });

  it('fails closed when the secret is not configured', () => {
    expect(readStaffSession(valid(), undefined, now)).toBeNull();
    expect(readStaffSession(valid(), '', now)).toBeNull();
  });

  it('returns null for a garbage cookie without throwing', () => {
    expect(readStaffSession('garbage', SECRET, now)).toBeNull();
  });
});

describe('staffCookieOptions', () => {
  it('is httpOnly, lax, path-scoped, and carries the given max age', () => {
    const opts = staffCookieOptions(60);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.path).toBe('/');
    expect(opts.maxAge).toBe(60);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/core/staff-auth.test.ts`
Expected: FAIL — cannot resolve `@/core/staff-auth`.

- [ ] **Step 3: Write `src/core/staff-auth.ts`**

```ts
import { verifySession, type StaffSession } from '@/core/staff-session';

export type StaffContext = { churchId: string; churchName: string };

/**
 * Reads a staff session from a raw cookie value. Kept free of `next/headers` so it can be
 * unit-tested; the request-bound helpers live in the staff layout and actions.
 */
export function readStaffSession(
  cookieValue: string | undefined,
  secret: string | undefined,
  now: Date = new Date(),
): StaffSession | null {
  if (!cookieValue || !secret) return null;
  return verifySession(cookieValue, secret, now);
}

export function staffCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV !== 'development',
    maxAge: maxAgeSeconds,
  };
}
```

- [ ] **Step 4: Write `src/app/staff/login/actions.ts`**

```ts
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { staffCookieOptions } from '@/core/staff-auth';
import {
  checkStaffPassword, SESSION_TTL_SECONDS, signSession, STAFF_COOKIE_NAME,
} from '@/core/staff-session';
import { getDb } from '@/db/client';
import { DEMO_CHURCH_SLUG, getChurchBySlug } from '@/db/repo/churches';

export async function signIn(_prev: { error?: string }, formData: FormData) {
  const password = String(formData.get('password') ?? '');
  if (!checkStaffPassword(password, process.env.STAFF_PASSWORD)) {
    // Deliberately vague: do not reveal whether the password is merely wrong or not
    // configured at all.
    return { error: 'Senha inválida.' };
  }

  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret) return { error: 'Senha inválida.' };

  const church = await getChurchBySlug(getDb(), DEMO_CHURCH_SLUG);
  if (!church) return { error: 'A igreja demo ainda não foi carregada.' };

  const issuedAt = Date.now();
  const token = signSession(
    { churchId: church.id, issuedAt, expiresAt: issuedAt + SESSION_TTL_SECONDS * 1000 },
    secret,
  );
  (await cookies()).set(STAFF_COOKIE_NAME, token, staffCookieOptions(SESSION_TTL_SECONDS));
  redirect('/staff');
}

export async function signOut() {
  (await cookies()).set(STAFF_COOKIE_NAME, '', staffCookieOptions(0));
  redirect('/staff/login');
}
```

- [ ] **Step 5: Write `src/app/staff/login/page.tsx`** (client form using `useActionState`)

```tsx
'use client';

import { useActionState } from 'react';
import { signIn } from './actions';

export default function StaffLogin() {
  const [state, action, pending] = useActionState(signIn, {} as { error?: string });

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Área da secretaria</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Igreja da Colina — igreja fictícia, demonstração.
        </p>
      </div>
      <form action={action} className="flex flex-col gap-3">
        <label htmlFor="password" className="text-sm">Senha</label>
        <input
          id="password" name="password" type="password" autoComplete="current-password" required
          className="rounded-xl border px-4 py-2 text-sm outline-none focus:border-neutral-400"
        />
        {state?.error && <p role="alert" className="text-sm text-amber-700">{state.error}</p>}
        <button
          type="submit" disabled={pending}
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: Write `src/app/staff/layout.tsx`** — the guard plus the shell

```tsx
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readStaffSession } from '@/core/staff-auth';
import { STAFF_COOKIE_NAME } from '@/core/staff-session';
import { signOut } from './login/actions';

export const metadata = { title: 'Secretaria — Igreja da Colina (demo)' };

const NAV = [
  { href: '/staff', label: 'Início' },
  { href: '/staff/documentos', label: 'Documentos' },
  { href: '/staff/agenda', label: 'Agenda' },
  { href: '/staff/oracoes', label: 'Orações' },
  { href: '/staff/atendimentos', label: 'Atendimentos' },
  { href: '/staff/uso', label: 'Uso' },
];

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // The login route renders its own page; everything else requires a session.
  const cookieStore = await cookies();
  const session = readStaffSession(
    cookieStore.get(STAFF_COOKIE_NAME)?.value,
    process.env.STAFF_SESSION_SECRET,
  );
  if (!session) redirect('/staff/login');

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-lg font-semibold">Secretaria — Igreja da Colina</h1>
          <p className="text-xs text-neutral-500">Igreja fictícia — demonstração</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-sm text-neutral-600 underline">Sair</button>
        </form>
      </header>
      <nav className="flex flex-wrap gap-3 border-b py-2 text-sm">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="text-emerald-800 hover:underline">
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1 py-4">{children}</div>
    </div>
  );
}
```

**Important:** `src/app/staff/login/page.tsx` sits UNDER this layout, which would redirect it in a loop. Move the login route OUT of the guarded segment — put the guard in a route group instead: create `src/app/staff/(dashboard)/layout.tsx` holding the guard + shell, move the dashboard pages under `(dashboard)/`, and leave `src/app/staff/login/` outside it with no guard. Verify no redirect loop before committing.

- [ ] **Step 7: Run the suite, typecheck, lint, build**

Run: `npx vitest run tests/core/staff-auth.test.ts && npm test && npm run typecheck && npx eslint src tests scripts && npm run build`
Expected: 5 new tests pass; everything green; build succeeds with the `/staff` routes listed.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(staff): password login, signed session cookie, guarded staff area"
```

---

### Task 3: Staff repositories — inbox queries and status updates

**Files:**
- Modify: `src/db/repo/prayer.ts`, `src/db/repo/tickets.ts`, `src/db/repo/documents.ts`
- Create: `src/db/repo/usage.ts`, `tests/db/staff-repos.test.ts`

**Interfaces:**
- `@/db/repo/prayer` gains: `setPrayerStatus(db, churchId, id, status)` where status is `'new' | 'praying' | 'done'`; `listPrayerRequests` gains an optional status filter.
- `@/db/repo/tickets` gains: `getTicket(db, churchId, id)`, `setTicketStatus(db, churchId, id, status)` (`'open' | 'answered' | 'closed'`), `saveSuggestedReply(db, churchId, id, reply)`.
- `@/db/repo/usage` provides: `usageSummary(db, churchId, now?)` → `{ totalUsd: number; byFeature: { feature: string; costUsd: number; calls: number }[]; monthlyUsd: number | null }`.
- All take `churchId` and filter on it in SQL.

- [ ] **Step 1: Write the failing test `tests/db/staff-repos.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createPrayerRequest, listPrayerRequests, setPrayerStatus } from '@/db/repo/prayer';
import { createTicket, getTicket, listTickets, saveSuggestedReply, setTicketStatus } from '@/db/repo/tickets';
import { usageSummary } from '@/db/repo/usage';
import { recordUsage } from '@/ai/usage';
import { CHAT_MODEL, FAST_MODEL } from '@/ai/pricing';
import { budgets } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

describe('prayer inbox', () => {
  it('moves a request through statuses, scoped to its church', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const req = await createPrayerRequest(db, { churchId: a.id, request: 'Pela minha avó' });

    await setPrayerStatus(db, a.id, req.id, 'praying');
    expect((await listPrayerRequests(db, a.id))[0].status).toBe('praying');

    // Another church cannot touch it.
    await setPrayerStatus(db, b.id, req.id, 'done');
    expect((await listPrayerRequests(db, a.id))[0].status).toBe('praying');
  });

  it('filters by status when asked', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const one = await createPrayerRequest(db, { churchId: church.id, request: 'Um' });
    await createPrayerRequest(db, { churchId: church.id, request: 'Dois' });
    await setPrayerStatus(db, church.id, one.id, 'done');
    expect(await listPrayerRequests(db, church.id, 'new')).toHaveLength(1);
    expect(await listPrayerRequests(db, church.id, 'done')).toHaveLength(1);
    expect(await listPrayerRequests(db, church.id)).toHaveLength(2);
  });
});

describe('ticket inbox', () => {
  it('stores a suggested reply and moves status, scoped to its church', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const ticket = await createTicket(db, { churchId: a.id, topic: 'Agendar batismo' });

    await saveSuggestedReply(db, a.id, ticket.id, 'Olá! Podemos agendar...');
    expect((await getTicket(db, a.id, ticket.id))?.suggestedReply).toContain('agendar');

    expect(await getTicket(db, b.id, ticket.id)).toBeUndefined();
    await setTicketStatus(db, b.id, ticket.id, 'closed');
    expect((await getTicket(db, a.id, ticket.id))?.status).toBe('open');

    await setTicketStatus(db, a.id, ticket.id, 'answered');
    expect((await listTickets(db, a.id))[0].status).toBe('answered');
  });
});

describe('usageSummary', () => {
  it('totals this month per feature for one tenant only', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    await db.insert(budgets).values({ churchId: a.id, monthlyUsd: 40 });

    await recordUsage(db, { churchId: a.id, feature: 'chat.reply', model: CHAT_MODEL, inputTokens: 1_000_000, outputTokens: 0 }); // $3
    await recordUsage(db, { churchId: a.id, feature: 'ingest.extract', model: FAST_MODEL, inputTokens: 1_000_000, outputTokens: 0 }); // $1
    await recordUsage(db, { churchId: b.id, feature: 'chat.reply', model: CHAT_MODEL, inputTokens: 1_000_000, outputTokens: 0 });

    const summary = await usageSummary(db, a.id);
    expect(summary.totalUsd).toBeCloseTo(4);
    expect(summary.monthlyUsd).toBe(40);
    const chat = summary.byFeature.find((f) => f.feature === 'chat.reply');
    expect(chat?.costUsd).toBeCloseTo(3);
    expect(chat?.calls).toBe(1);
    expect(summary.byFeature.map((f) => f.feature)).not.toContain('nonexistent');
  });

  it('reports a null budget when the tenant has no budget row', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    expect((await usageSummary(db, church.id)).monthlyUsd).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/db/staff-repos.test.ts`
Expected: FAIL — `setPrayerStatus` / `@/db/repo/usage` do not exist.

- [ ] **Step 3: Extend the repos**

Add to `src/db/repo/prayer.ts`:

```ts
export type PrayerStatus = 'new' | 'praying' | 'done';

export async function setPrayerStatus(
  db: Db, churchId: string, id: string, status: PrayerStatus,
): Promise<void> {
  await db
    .update(prayerRequests)
    .set({ status })
    .where(and(eq(prayerRequests.churchId, churchId), eq(prayerRequests.id, id)));
}
```

and give `listPrayerRequests` an optional `status` filter (keep the existing no-argument behaviour identical). Import `and` from `drizzle-orm`.

Add to `src/db/repo/tickets.ts`:

```ts
export type TicketStatus = 'open' | 'answered' | 'closed';

export async function getTicket(db: Db, churchId: string, id: string) {
  const [row] = await db
    .select().from(tickets)
    .where(and(eq(tickets.churchId, churchId), eq(tickets.id, id)));
  return row;
}

export async function setTicketStatus(
  db: Db, churchId: string, id: string, status: TicketStatus,
): Promise<void> {
  await db.update(tickets).set({ status })
    .where(and(eq(tickets.churchId, churchId), eq(tickets.id, id)));
}

export async function saveSuggestedReply(
  db: Db, churchId: string, id: string, reply: string,
): Promise<void> {
  await db.update(tickets).set({ suggestedReply: reply })
    .where(and(eq(tickets.churchId, churchId), eq(tickets.id, id)));
}
```

Create `src/db/repo/usage.ts`:

```ts
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { budgets, usageLedger } from '@/db/schema';

export type UsageSummary = {
  totalUsd: number;
  byFeature: { feature: string; costUsd: number; calls: number }[];
  monthlyUsd: number | null;
};

/** Month-to-date spend for one tenant, grouped by feature, plus its configured cap. */
export async function usageSummary(
  db: Db, churchId: string, now: Date = new Date(),
): Promise<UsageSummary> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const rows = await db
    .select({
      feature: usageLedger.feature,
      costUsd: sql<number>`coalesce(sum(${usageLedger.costUsd}), 0)`,
      calls: sql<number>`count(*)`,
    })
    .from(usageLedger)
    .where(and(eq(usageLedger.churchId, churchId), gte(usageLedger.createdAt, start)))
    .groupBy(usageLedger.feature);

  const byFeature = rows
    .map((r) => ({ feature: r.feature, costUsd: Number(r.costUsd), calls: Number(r.calls) }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const [budget] = await db.select().from(budgets).where(eq(budgets.churchId, churchId));

  return {
    totalUsd: byFeature.reduce((sum, f) => sum + f.costUsd, 0),
    byFeature,
    monthlyUsd: budget ? budget.monthlyUsd : null,
  };
}
```

- [ ] **Step 4: Run tests, full suite, typecheck, lint**

Run: `npx vitest run tests/db/staff-repos.test.ts && npm test && npm run typecheck && npx eslint src tests scripts`
Expected: 5 new tests pass; suite green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(staff): inbox status transitions and month-to-date usage summary"
```

---

### Task 4: Reply-drafter agent

**Files:**
- Create: `src/agent/reply-drafter.ts`, `tests/agent/reply-drafter.test.ts`

**Interfaces:**
- Produces from `@/agent/reply-drafter`: `draftReply(deps, input): Promise<{ reply: string; sources: Source[] }>` where `deps = { db: Db; embedder: Embedder; model?: LanguageModel }` and `input = { churchId: string; churchName: string; ticketId: string; topic: string; conversationExcerpt?: string }`.
- Meters `support.draft` (the model call) and `support.retrieval` (the embedding call).

- [ ] **Step 1: Write the failing test `tests/agent/reply-drafter.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { draftReply } from '@/agent/reply-drafter';
import { HashEmbedder } from '@/ai/embedder';
import { chunkMarkdown } from '@/core/chunking';
import type { Db } from '@/db/client';
import { chunks, documents, usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

async function textModel(text: string) {
  const { MockLanguageModelV3 } = await import('ai/test');
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 90, noCache: 90, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 25, text: 25, reasoning: undefined },
      },
      content: [{ type: 'text', text }],
      warnings: [],
    }),
  });
}

async function seedDoc(db: Db, churchId: string) {
  const embedder = new HashEmbedder();
  const [doc] = await db.insert(documents)
    .values({ churchId, title: 'Horários e Contato', kind: 'schedule' }).returning();
  const pieces = chunkMarkdown('## Batismo\n\nOs batismos acontecem no último domingo do mês, às 18h30.');
  const { embeddings } = await embedder.embed(pieces.map((p) => p.content));
  await db.insert(chunks).values(pieces.map((p, i) => ({
    churchId, documentId: doc.id, seq: p.seq, content: p.content, embedding: embeddings[i],
  })));
}

describe('draftReply', () => {
  it('drafts a reply grounded in the knowledge base and meters both calls', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db, 'Igreja da Colina');
    await seedDoc(db, church.id);

    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model: await textModel('Olá! Os batismos acontecem no último domingo do mês, às 18h30.') },
      { churchId: church.id, churchName: church.name, ticketId: crypto.randomUUID(), topic: 'quando é o batismo?' },
    );

    expect(out.reply).toContain('18h30');
    expect(out.sources.length).toBeGreaterThan(0);
    expect(out.sources[0].documentTitle).toBe('Horários e Contato');

    const ledger = await db.select().from(usageLedger);
    expect(ledger.some((u) => u.feature === 'support.draft')).toBe(true);
    expect(ledger.some((u) => u.feature === 'support.retrieval')).toBe(true);
  });

  it('still returns a draft when the knowledge base has nothing relevant', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model: await textModel('Não encontrei essa informação; vou verificar e retorno.') },
      { churchId: church.id, churchName: church.name, ticketId: crypto.randomUUID(), topic: 'xyzzy quux' },
    );
    expect(out.reply.length).toBeGreaterThan(0);
    expect(out.sources).toEqual([]);
  });

  it('never surfaces another tenant’s documents', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    await seedDoc(db, b.id);
    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model: await textModel('...') },
      { churchId: a.id, churchName: a.name, ticketId: crypto.randomUUID(), topic: 'batismo' },
    );
    expect(out.sources).toEqual([]);
  });

  it('returns a safe fallback instead of throwing when the model fails', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const { MockLanguageModelV3 } = await import('ai/test');
    const model = new MockLanguageModelV3({ doGenerate: async () => { throw new Error('gateway down'); } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model },
      { churchId: church.id, churchName: church.name, ticketId: crypto.randomUUID(), topic: 'batismo' },
    );
    expect(out.reply).toBe('');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/agent/reply-drafter.test.ts`
Expected: FAIL — cannot resolve `@/agent/reply-drafter`.

- [ ] **Step 3: Write `src/agent/reply-drafter.ts`**

```ts
import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { Embedder } from '@/ai/embedder';
import { FAST_MODEL, priceableModelId } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import { searchKnowledgeBase, type Source } from '@/core/retrieval';
import type { Db } from '@/db/client';

export type ReplyDrafterDeps = { db: Db; embedder: Embedder; model?: LanguageModel };
export type ReplyDrafterInput = {
  churchId: string;
  churchName: string;
  ticketId: string;
  topic: string;
  conversationExcerpt?: string;
};

/**
 * Drafts a reply for a staff member to EDIT and send — it is never sent automatically.
 * That is why a model failure returns an empty draft rather than throwing: the staff
 * member can always write the reply themselves, and a broken drafter must not block the
 * inbox.
 */
export async function draftReply(
  deps: ReplyDrafterDeps,
  input: ReplyDrafterInput,
): Promise<{ reply: string; sources: Source[] }> {
  const { sources, embeddingTokens } = await searchKnowledgeBase(
    deps.db, deps.embedder, input.churchId, input.topic,
  );

  try {
    await recordUsage(deps.db, {
      churchId: input.churchId, feature: 'support.retrieval',
      model: deps.embedder.model, inputTokens: embeddingTokens, outputTokens: 0,
    });
  } catch (error) {
    console.error('support.retrieval usage not recorded', { ticketId: input.ticketId, error });
  }

  const grounding = sources.length
    ? sources.map((s) => `- ${s.documentTitle}: ${s.excerpt}`).join('\n')
    : '(nada encontrado na base de conhecimento)';

  try {
    const { text, usage } = await generateText({
      model: deps.model ?? FAST_MODEL,
      system: [
        `You draft replies for the secretary of ${input.churchName}, a Brazilian church.`,
        'Write in Brazilian Portuguese, warm and brief — two or three sentences.',
        'Use ONLY the church information provided below. If it does not answer the question, say plainly that you will check and get back to them; never invent a fact.',
        'This is a DRAFT a staff member will read, edit, and send. Do not sign it, and do not promise anything the church has not stated.',
      ].join('\n'),
      prompt: [
        `ASSUNTO: ${input.topic}`,
        input.conversationExcerpt ? `\nCONVERSA:\n${input.conversationExcerpt}` : '',
        `\nINFORMAÇÕES DA IGREJA:\n${grounding}`,
      ].join('\n'),
    });

    try {
      await recordUsage(deps.db, {
        churchId: input.churchId, feature: 'support.draft',
        model: priceableModelId(deps.model ?? FAST_MODEL, FAST_MODEL),
        inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0,
      });
    } catch (error) {
      console.error('support.draft usage not recorded', { ticketId: input.ticketId, error });
    }

    return { reply: text, sources };
  } catch (error) {
    console.error('support.draft failed; returning an empty draft', {
      churchId: input.churchId, ticketId: input.ticketId, error,
    });
    return { reply: '', sources };
  }
}
```

- [ ] **Step 4: Run tests, full suite, typecheck, lint**

Run: `npx vitest run tests/agent/reply-drafter.test.ts && npm test && npm run typecheck && npx eslint src tests scripts`
Expected: 4 new tests pass; suite green.

If `generateText`'s mock contract differs, mirror the shape already working in `tests/agent/extractor.test.ts`. Adapt the TEST, never the production types.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(staff): reply drafter grounded in the knowledge base"
```

---

### Task 5: Staff pages — home, documents (with upload), agenda

**Files:**
- Create: `src/app/staff/(dashboard)/page.tsx`, `src/app/staff/(dashboard)/documentos/page.tsx`, `src/app/staff/(dashboard)/documentos/actions.ts`, `src/app/staff/(dashboard)/agenda/page.tsx`, `src/core/staff-context.ts`
- Create: `tests/core/staff-context.test.ts`

**Interfaces:**
- `@/core/staff-context` exports `requireStaffContext(): Promise<StaffContext>` — reads the cookie via `next/headers`, verifies it, loads the church, and `redirect`s to `/staff/login` when absent. Every dashboard page and action calls it; **no page or action may take a `churchId` from the request.**
- The documents page lists documents with their ingest status; its action uploads a file and runs the pipeline via `runIngest`, reusing `createDocument`/`beginIngestRun` semantics through the same code path the ingest route uses.

- [ ] **Step 1: Write `src/core/staff-context.ts`**

```ts
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readStaffSession, type StaffContext } from '@/core/staff-auth';
import { STAFF_COOKIE_NAME } from '@/core/staff-session';
import { getDb } from '@/db/client';
import { getChurchBySlug, DEMO_CHURCH_SLUG } from '@/db/repo/churches';

/**
 * The ONLY way a staff page or action learns which church it is acting for. Deriving the
 * tenant from the signed session — never from a form field or query parameter — is what
 * keeps every staff mutation tenant-scoped by construction.
 */
export async function requireStaffContext(): Promise<StaffContext> {
  const cookieStore = await cookies();
  const session = readStaffSession(
    cookieStore.get(STAFF_COOKIE_NAME)?.value,
    process.env.STAFF_SESSION_SECRET,
  );
  if (!session) redirect('/staff/login');

  const church = await getChurchBySlug(getDb(), DEMO_CHURCH_SLUG);
  if (!church || church.id !== session.churchId) redirect('/staff/login');

  return { churchId: church.id, churchName: church.name };
}
```

- [ ] **Step 2: Write the documents action `src/app/staff/(dashboard)/documentos/actions.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { GatewayEmbedder } from '@/ai/embedder';
import { FAST_MODEL } from '@/ai/pricing';
import { checkBudget } from '@/ai/usage';
import { DEFAULT_GLOBAL_CAP_USD, parseGlobalCapUsd } from '@/core/config';
import { runIngest } from '@/core/ingest';
import { hasUnstorableChars } from '@/core/ingest';
import { UnsupportedMediaTypeError, parseDocument } from '@/core/parse-document';
import { checkRateLimit } from '@/core/rate-limit';
import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import { createDocument } from '@/db/repo/documents';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const STAFF_INGEST_LIMIT = { limit: 10, windowSeconds: 3600 };

export async function uploadDocument(_prev: { error?: string; ok?: string }, formData: FormData) {
  const { churchId } = await requireStaffContext();
  const db = getDb();

  const file = formData.get('file');
  const title = String(formData.get('title') ?? '').trim();
  if (!(file instanceof File) || !title) return { error: 'Escolha um arquivo e informe um título.' };
  if (title.length > 300) return { error: 'Título muito longo.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'Arquivo maior que 5 MB.' };

  const rate = await checkRateLimit(db, `staff-ingest:${churchId}`, STAFF_INGEST_LIMIT);
  if (!rate.allowed) return { error: 'Muitos envios nesta hora. Tente mais tarde.' };

  const budget = await checkBudget(
    db, churchId, parseGlobalCapUsd(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP ?? String(DEFAULT_GLOBAL_CAP_USD)),
  );
  if (!budget.allowed) return { error: 'O limite de uso do mês foi atingido.' };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';

  try {
    const parsed = await parseDocument(bytes, mimeType);
    if (hasUnstorableChars(parsed.text)) return { error: 'O arquivo contém caracteres inválidos.' };
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) return { error: 'Formato não suportado. Envie PDF ou Markdown.' };
    return { error: 'Não foi possível ler o arquivo.' };
  }

  const doc = await createDocument(db, { churchId, title, kind: 'upload', sourcePath: file.name });
  const result = await runIngest(
    { db, embedder: new GatewayEmbedder(), extractorModel: FAST_MODEL, verifierModel: FAST_MODEL },
    { churchId, documentId: doc.id, bytes, mimeType },
  );

  revalidatePath('/staff/documentos');
  revalidatePath('/staff/agenda');

  if (result.status === 'failed') return { error: 'A leitura do documento falhou. Veja o status na lista.' };
  return {
    ok: `Documento processado: ${result.chunkCount} trechos, ${result.published} evento(s) publicado(s).`,
  };
}
```

If `hasUnstorableChars` is not exported from `@/core/ingest` (Plan 2 may have placed it in the channel), import it from wherever it lives, or export it from a shared module — do not duplicate the implementation.

- [ ] **Step 3: Write the documents page** `src/app/staff/(dashboard)/documentos/page.tsx`

A server component that calls `requireStaffContext()`, `listDocuments(getDb(), churchId)`, renders a table (title, kind, status badge, error when failed, created date) and mounts a small client component with the upload form wired to `uploadDocument` via `useActionState`. Show the ingest status in Portuguese (`enviado`, `lendo`, `extraindo`, `verificando`, `publicado`, `falhou`). Keep the client component in its own file.

- [ ] **Step 4: Write the agenda page** `src/app/staff/(dashboard)/agenda/page.tsx`

Server component: `listUpcomingEvents(getDb(), churchId, 50)`, rendering each event with its date (formatted `pt-BR`, America/Sao_Paulo), location, and — because provenance is a selling point — the `verificationNote` and a short `sourceQuote` when present, plus a link to the source document's title.

- [ ] **Step 5: Write the staff home page** `src/app/staff/(dashboard)/page.tsx`

Server component with counts: open tickets, new prayer requests, documents published/failed, month-to-date spend against the cap, and links into each section. Keep it small — it is a hub, not a dashboard.

- [ ] **Step 6: Write `tests/core/staff-context.test.ts`**

`requireStaffContext` depends on `next/headers`, so test the decision logic that is testable without a request: given a session whose `churchId` does not match the loaded church, it must redirect rather than return a context. Mock `next/headers` and `next/navigation` with `vi.mock`, and assert `redirect` was called for: no cookie, invalid cookie, and a session whose `churchId` differs from the demo church's. Assert it returns the context for a valid session.

- [ ] **Step 7: Run everything**

Run: `npm test && npm run typecheck && npx eslint src tests scripts && npm run build`
Expected: green; build lists the new `/staff` routes as dynamic Node routes.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(staff): documents, upload, and agenda pages"
```

---

### Task 6: Inboxes — prayer requests and support tickets with AI-drafted replies

**Files:**
- Create: `src/app/staff/(dashboard)/oracoes/page.tsx`, `src/app/staff/(dashboard)/oracoes/actions.ts`, `src/app/staff/(dashboard)/atendimentos/page.tsx`, `src/app/staff/(dashboard)/atendimentos/actions.ts`, plus their client components
- Create: `tests/app/staff-actions.test.ts`

**Interfaces:**
- `oracoes/actions.ts`: `updatePrayerStatus(formData)` — reads `id` and `status` from the form, derives `churchId` from the session.
- `atendimentos/actions.ts`: `suggestReply(formData)` (calls `draftReply`, saves via `saveSuggestedReply`), `sendReply(formData)` (persists the edited text as an assistant message on the ticket's conversation via `saveMessage`, then sets the ticket to `answered`), `updateTicketStatus(formData)`.
- **Every action derives `churchId` from `requireStaffContext()` and passes it to the repo functions, which filter on it in SQL.** A form field must never carry a church id.

- [ ] **Step 1: Write the failing test `tests/app/staff-actions.test.ts`**

Test the ACTION LOGIC by extracting it into plain functions the actions call, so it is testable without a request context. Create `src/core/staff-operations.ts` exporting:

```ts
export async function applyPrayerStatus(db: Db, churchId: string, id: string, status: PrayerStatus): Promise<void>
export async function suggestTicketReply(deps, input): Promise<{ reply: string }>
export async function sendTicketReply(db: Db, churchId: string, ticketId: string, reply: string): Promise<void>
```

and have the Server Actions be thin wrappers that call `requireStaffContext()` and delegate. Test:

- `applyPrayerStatus` moves status and refuses cross-tenant (already covered at the repo level — assert the operation layer passes `churchId` through correctly).
- `suggestTicketReply` stores the draft on the ticket and returns it; a failing model yields an empty draft and does NOT overwrite an existing good draft with an empty string.
- `sendTicketReply` persists the reply as an assistant message on the ticket's conversation AND flips the ticket to `answered`; it refuses an empty reply; it refuses a ticket belonging to another church (nothing written, status unchanged).
- `sendTicketReply` on a ticket with no conversation still marks it answered without throwing.

Write real assertions against the database, using `createTestDb`/`seedChurch` and a mock model as in Task 4.

- [ ] **Step 2: Run it and confirm it fails, then implement `src/core/staff-operations.ts`**

Keep it small: it is glue between the repos and the drafter, and the place the tenant id is enforced. Guard each operation by loading the target row scoped to `churchId` first and returning early when it is absent.

- [ ] **Step 3: Write the prayer inbox page and action**

Server component listing requests newest-first with a status filter, each row offering status buttons (`Nova`, `Orando`, `Concluída`) posting to `updatePrayerStatus`. Show the request text, the optional name, and the date. `revalidatePath('/staff/oracoes')` after a change.

- [ ] **Step 4: Write the support inbox page and actions**

Server component listing tickets newest-first with status, topic, and date. Each open ticket offers:
- **"Sugerir resposta"** → `suggestReply`, which drafts and persists the suggestion;
- a textarea prefilled with `suggestedReply` that the staff member edits;
- **"Enviar"** → `sendReply`, which persists the edited text into the conversation and marks the ticket `answered`.

Make it visually obvious that the draft is AI-generated and unsent until the human sends it (a label such as "Rascunho da IA — revise antes de enviar"). Show the grounding sources under the draft when present.

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npx eslint src tests scripts && npm run build`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(staff): prayer and support inboxes with human-approved AI drafts"
```

---

### Task 7: Usage page, retire `INGEST_TOKEN`, verify in a browser, update the brain

**Files:**
- Create: `src/app/staff/(dashboard)/uso/page.tsx`
- Modify: `src/channels/ingest-http.ts`, `src/app/api/ingest/route.ts`, `.env.example`, `README.md`, `brain/status.md`, `brain/log/decisions.md`

- [ ] **Step 1: Write the usage page**

Server component using `usageSummary(getDb(), churchId)`: month-to-date total against the cap (with a simple bar), a per-feature table (feature, calls, cost, share), and a short English-free explanation in Portuguese of what each feature means (`chat.reply`, `chat.retrieval`, `ingest.embed`, `ingest.extract`, `ingest.verify`, `support.draft`, `support.retrieval`). Format money to four decimal places — these are fractions of a cent.

- [ ] **Step 2: Retire `INGEST_TOKEN`**

Plan 2 shipped the shared token as an explicit placeholder for real staff auth, with a recorded decision that it must be **retired, not stacked**, once this plan landed. Do that:
- Accept a valid staff session cookie as authorisation for `POST /api/ingest`.
- Remove the `INGEST_TOKEN` path and its env var from `.env.example`, or — if you judge the token still earns its keep for scripted/CI ingestion — keep it but say so explicitly in your report and update the Plan 2 decision entry rather than leaving it contradicted. Pick one and make the docs match the code.
- Update the ingest route's tests accordingly. Do not weaken the fail-closed property: with no valid session (and no token, if you removed it), the endpoint must reject.

- [ ] **Step 3: Verify in a browser**

Start the dev server for THIS project (note: the preview tooling may be rooted at the sibling `ChurchChatBox` repo — start it explicitly from `/Users/rafaelpupiovieira/Desktop/Tech/ChurchChatBoxV2` and confirm the page says *Igreja da Colina*). There is no database in this environment, so pages that query will error — that is expected. Verify what CAN be verified without a database: `/staff/login` renders, submitting a wrong password shows the Portuguese error and does not sign in, and the guarded routes redirect to `/staff/login` when unauthenticated. Take a screenshot of the login page. Report exactly what you observed, and say plainly what you could not verify.

- [ ] **Step 4: Update the README and the brain**

`README.md`: add the staff area to "what works today" — login, knowledge-base management with upload, agenda with extraction provenance, prayer and support inboxes with human-approved AI drafts, usage meter. Keep the honest status framing (still not deployed).

`brain/status.md`: Plan 3 delivered; what remains (Plan 4: reporting + landing page); the deployment blocker still standing (Neon marketplace terms need a browser).

`brain/log/decisions.md`: append a dated Plan 3 section with the WHY: why the tenant id comes only from the signed session and never from a form field; why the AI reply is a draft a human edits rather than an auto-send; why the drafter returns an empty draft instead of throwing; why staff actions are still rate-limited and budget-gated despite being authenticated; and what you decided about `INGEST_TOKEN`.

- [ ] **Step 5: Run everything and commit**

```bash
npm test && npm run typecheck && npx eslint src tests scripts && npm run build
git add -A && git commit -m "feat(staff): usage meter, retire the ingest placeholder token, document Plan 3"
```

---

## Self-Review Notes

- **Spec coverage (Plan 3 scope):** AI Customer Support (Tasks 4, 6 — escalated tickets, AI-suggested replies, human send), AI Knowledge Bases as a managed surface (Task 5 — documents list, upload, ingest status), calendar with extraction provenance (Task 5), usage/cost visibility (Tasks 3, 7). Reporting (the weekly AI digest) and the portfolio landing page are Plan 4.
- **Security posture:** the tenant id is derived from a signed, httpOnly session and never from client input; password and session checks both fail closed; staff actions remain rate-limited and budget-gated, because an authenticated session on a public demo is still an untrusted spend path.
- **Deliberately not built:** multiple staff accounts, roles, password reset, audit log, real email/WhatsApp delivery of a sent reply (it is persisted to the conversation), and document download (the original bytes are not stored — Plan 2 dropped `source_text` and never stored the file).
- **Risk flagged inline:** the route-group refactor in Task 2 (login must sit outside the guarded segment or it redirect-loops) is the most likely place to lose time; verify before committing.
