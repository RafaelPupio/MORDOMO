'use client';

import { useEffect } from 'react';

// Catches a thrown error anywhere below this route group's layout — most concretely, a DB
// failure inside `requireStaffContext()` (src/core/staff-context.ts), which every staff
// page and Server Action calls to resolve `churchId` and which is deliberately called OUTSIDE
// each Server Action's own try/catch so that `redirect('/staff/login')` isn't swallowed as if
// it were a caught error (see that function's doc comment). Without this boundary, a Neon
// cold start or any other DB outage inside that call surfaced as a raw `NeonDbError` stack in
// a Next.js error digest — reproduced live as `GET /staff/documentos 500` (I3).
//
// `redirect()` throws internally too, but with a special `NEXT_REDIRECT` digest that Next.js
// intercepts before it ever reaches an error boundary like this one — so this component never
// intercepts a legitimate redirect, only a genuine failure. Nothing about that interception
// depends on this file; it's why `requireStaffContext` didn't need to change to get a
// controlled outcome here.
//
// Error boundaries in the App Router MUST be Client Components.
export default function StaffAreaError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The staff member only ever sees the Portuguese message below; this is what lets the
    // real failure still be found in server/browser logs.
    console.error('staff area: unhandled error', error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center p-4">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border p-6 text-center">
        <h2 className="text-base font-semibold">Não foi possível carregar esta página</h2>
        <p className="text-sm text-neutral-600">
          Algo deu errado ao falar com o banco de dados. Isso costuma ser passageiro — tente
          novamente em instantes.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-1 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  );
}
