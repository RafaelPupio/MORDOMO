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
