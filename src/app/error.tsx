'use client';

import { useEffect } from 'react';

// Root error boundary for the public pages (/, /chat). The staff area has its own under
// src/app/staff/(dashboard)/error.tsx; without this one, a failure on the public side was
// Next's unbranded "Application error" screen.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('public site: unhandled error', error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center p-4">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border p-6 text-center">
        <p className="font-mono text-xs tracking-[0.16em] text-neutral-500 uppercase">MORDOMO</p>
        <h1 className="text-base font-semibold">Algo deu errado · Something went wrong</h1>
        <p className="text-sm text-neutral-600">
          Isso costuma ser passageiro. · This is usually temporary.
        </p>
        <button type="button" onClick={reset} className="mt-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
          Tentar novamente · Try again
        </button>
      </div>
    </main>
  );
}
