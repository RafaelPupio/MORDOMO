import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clerkProvider = vi.fn();
const signIn = vi.fn();
const signUp = vi.fn();
const protect = vi.fn();

const clerkMiddleware = vi.hoisted(() => vi.fn((handler) => handler));
const createRouteMatcher = vi.hoisted(() => vi.fn((patterns: string[]) => {
  const matchers = patterns.map((pattern) => new RegExp(`^${pattern}$`));
  return (request: { nextUrl: { pathname: string } }) => (
    matchers.some((matcher) => matcher.test(request.nextUrl.pathname))
  );
}));

vi.mock('@clerk/nextjs', () => ({
  ClerkProvider: clerkProvider,
  SignIn: signIn,
  SignUp: signUp,
}));

vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware,
  createRouteMatcher,
}));

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'geist-sans' }),
  Geist_Mono: () => ({ variable: 'geist-mono' }),
}));

beforeEach(() => {
  protect.mockReset();
});

describe('authentication shell', () => {
  it('wraps the app in ClerkProvider and exposes Clerk sign-in and sign-up pages', async () => {
    const { default: RootLayout } = await import('@/app/layout');
    const { default: SignInPage } = await import('@/app/sign-in/[[...sign-in]]/page');
    const { default: SignUpPage } = await import('@/app/sign-up/[[...sign-up]]/page');

    const layout = RootLayout({ children: createElement('main') });
    const body = layout.props.children;

    expect(body.type).toBe('body');
    expect(body.props.children.type).toBe(clerkProvider);
    expect(SignInPage().type).toBe(signIn);
    expect(SignUpPage().type).toBe(signUp);
  });

  it.each([
    '/studio',
    '/studio/profile',
    '/onboarding',
    '/onboarding/start',
    '/en/studio',
    '/en/studio/profile',
    '/pt/onboarding',
    '/pt/onboarding/start',
  ])('protects the account route %s', async (pathname) => {
    const { default: proxy } = await import('@/proxy');
    const proxyHandler = proxy as unknown as (
      auth: { protect: typeof protect },
      request: { nextUrl: { pathname: string } },
    ) => Promise<void>;

    await proxyHandler(
      { protect },
      { nextUrl: { pathname } },
    );

    expect(protect).toHaveBeenCalledOnce();
  });

  it.each(['/', '/en', '/pt', '/en/about', '/pt/portfolio'])(
    'leaves the public portfolio route %s unprotected',
    async (pathname) => {
      const { default: proxy } = await import('@/proxy');
      const proxyHandler = proxy as unknown as (
        auth: { protect: typeof protect },
        request: { nextUrl: { pathname: string } },
      ) => Promise<void>;

      await proxyHandler(
        { protect },
        { nextUrl: { pathname } },
      );

      expect(protect).not.toHaveBeenCalled();
    },
  );
});
