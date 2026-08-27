import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

const clerkProvider = vi.fn();
const signIn = vi.fn();
const signUp = vi.fn();

vi.mock('@clerk/nextjs', () => ({
  ClerkProvider: clerkProvider,
  SignIn: signIn,
  SignUp: signUp,
}));

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'geist-sans' }),
  Geist_Mono: () => ({ variable: 'geist-mono' }),
}));

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
});
