'use client';

import { useActionState } from 'react';
import { uploadDocument, type UploadState } from './actions';

const INITIAL_STATE: UploadState = {};

export function UploadForm() {
  const [state, action, pending] = useActionState(uploadDocument, INITIAL_STATE);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">Enviar documento</h3>
        <p className="mt-1 text-xs text-neutral-500">
          PDF ou Markdown, até 5 MB. O arquivo é lido, indexado para busca e verificado
          automaticamente antes de qualquer evento entrar na agenda.
        </p>
      </div>

      <label htmlFor="title" className="text-sm">Título</label>
      <input
        id="title" name="title" type="text" required maxLength={300}
        placeholder="Ex.: Boletim de domingo — 23/08"
        className="rounded-xl border px-4 py-2 text-sm outline-none focus:border-neutral-400"
      />

      <label htmlFor="file" className="text-sm">Arquivo</label>
      <input
        id="file" name="file" type="file" required
        accept=".pdf,.md,application/pdf,text/markdown,text/plain"
        className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm"
      />

      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-emerald-700">{state.ok}</p>}

      <button
        type="submit" disabled={pending}
        className="self-start rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Enviando…' : 'Enviar'}
      </button>
    </form>
  );
}
