import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TTL_SECONDS, signSession } from '@/core/staff-session';
// Import after the vi.mock calls below in source order for readability — Vitest hoists
// every `vi.mock` call to the top of the module regardless of where it's written, so this
// import resolves against the mocked `next/headers` / `next/navigation` / `@/db/*` either
// way (same pattern as tests/channels/ingest-http.test.ts's `parseDocumentMock`).
import { requireStaffContext } from '@/core/staff-context';

// `requireStaffContext` depends on `next/headers` (request-bound, cannot be called outside
// a request) and on a real DB connection (`getDb()`/`getOrganizationBySlug`, unavailable in this
// test environment). Both are mocked so the function's own decision logic — session
// verification plus the organization-id cross-check — is what's actually under test; the real
// `readStaffSession`/`signSession` (@/core/staff-session, @/core/staff-auth) are NOT mocked,
// so a garbage or tampered cookie is rejected by the real signature check, not a stub.
const cookiesGetMock = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: cookiesGetMock })),
}));

// The real `redirect()` throws internally to interrupt rendering — mirroring that here
// (rather than a no-op mock) means a caller that forgot to `return`/rely on the throw would
// still fail this test the same way it would fail in production, not silently continue.
const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
}));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

const getOrganizationBySlugMock = vi.hoisted(() => vi.fn());
vi.mock('@/db/repo/organizations', () => ({
  DEMO_ORGANIZATION_SLUG: 'demo',
  getOrganizationBySlug: getOrganizationBySlugMock,
}));

// Never actually reached with a real driver — getOrganizationBySlug is mocked above and ignores
// whatever `getDb()` returns — but staff-context.ts calls `getDb()` unconditionally, and the
// real implementation throws when DATABASE_URL is unset (true in this test environment).
vi.mock('@/db/client', () => ({ getDb: vi.fn(() => ({})) }));

const SECRET = 'a-secret';
const DEMO_ORGANIZATION_ID = '11111111-1111-1111-1111-111111111111';
const DEMO_ORGANIZATION_NAME = 'Igreja da Colina';

// `requireStaffContext` calls `readStaffSession` with no explicit `now`, so it checks
// expiry against the REAL wall clock (`src/core/staff-auth.ts`'s default `now = new
// Date()`) — a token timestamped to a fixed past instant would read as expired whenever
// the suite happens to run. Signed relative to `Date.now()` instead, same as the login
// action does in production (src/app/staff/login/actions.ts).
function tokenFor(organizationId: string) {
  const issuedAt = Date.now();
  return signSession(
    { organizationId, issuedAt, expiresAt: issuedAt + SESSION_TTL_SECONDS * 1000 },
    SECRET,
  );
}

beforeEach(() => {
  process.env.STAFF_SESSION_SECRET = SECRET;
  cookiesGetMock.mockReset();
  redirectMock.mockClear();
  getOrganizationBySlugMock.mockReset();
  getOrganizationBySlugMock.mockResolvedValue({ id: DEMO_ORGANIZATION_ID, name: DEMO_ORGANIZATION_NAME });
});

describe('requireStaffContext', () => {
  it('redirects to /staff/login when there is no cookie', async () => {
    cookiesGetMock.mockReturnValue(undefined);
    await expect(requireStaffContext()).rejects.toThrow('REDIRECT:/staff/login');
    expect(redirectMock).toHaveBeenCalledWith('/staff/login');
    expect(getOrganizationBySlugMock).not.toHaveBeenCalled();
  });

  it('redirects to /staff/login for an invalid/garbage cookie', async () => {
    cookiesGetMock.mockReturnValue({ value: 'garbage-not-a-real-token' });
    await expect(requireStaffContext()).rejects.toThrow('REDIRECT:/staff/login');
    expect(redirectMock).toHaveBeenCalledWith('/staff/login');
  });

  // The load-bearing check (see the doc comment on requireStaffContext): a session signed
  // for an organization id that no longer matches the freshly loaded demo organization — e.g. because the
  // demo was re-seeded and got a new organization row — must be rejected, not trusted on the
  // strength of its own signature alone.
  it('redirects to /staff/login when the session organizationId differs from the loaded organization', async () => {
    const otherOrganizationId = '22222222-2222-2222-2222-222222222222';
    cookiesGetMock.mockReturnValue({ value: tokenFor(otherOrganizationId) });
    getOrganizationBySlugMock.mockResolvedValue({ id: DEMO_ORGANIZATION_ID, name: DEMO_ORGANIZATION_NAME });

    await expect(requireStaffContext()).rejects.toThrow('REDIRECT:/staff/login');
    expect(redirectMock).toHaveBeenCalledWith('/staff/login');
  });

  it('redirects to /staff/login when the demo organization cannot be loaded at all', async () => {
    cookiesGetMock.mockReturnValue({ value: tokenFor(DEMO_ORGANIZATION_ID) });
    getOrganizationBySlugMock.mockResolvedValue(undefined);

    await expect(requireStaffContext()).rejects.toThrow('REDIRECT:/staff/login');
    expect(redirectMock).toHaveBeenCalledWith('/staff/login');
  });

  it('returns the staff context for a valid session matching the loaded organization', async () => {
    cookiesGetMock.mockReturnValue({ value: tokenFor(DEMO_ORGANIZATION_ID) });
    getOrganizationBySlugMock.mockResolvedValue({ id: DEMO_ORGANIZATION_ID, name: DEMO_ORGANIZATION_NAME });

    await expect(requireStaffContext()).resolves.toEqual({
      organizationId: DEMO_ORGANIZATION_ID,
      organizationName: DEMO_ORGANIZATION_NAME,
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
