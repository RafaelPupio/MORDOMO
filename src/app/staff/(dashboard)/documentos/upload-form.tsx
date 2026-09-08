'use client';

import { useActionState, useState } from 'react';
import { MAX_UPLOAD_BYTES } from '@/core/config';
import { uploadDocument } from './actions';
import type { UploadState } from './upload-state';

const INITIAL_STATE: UploadState = {};

export function UploadForm() {
  const [state, action, pending] = useActionState(uploadDocument, INITIAL_STATE);
  // Checked here, before the request leaves the browser: the multipart body is capped by
  // next.config's serverActions.bodySizeLimit, and an oversized file used to reach that
  // cap first and come back as a bare 413 the form could not explain.
  const [tooLarge, setTooLarge] = useState<string | null>(null);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const file = (event.currentTarget.elements.namedItem('file') as HTMLInputElement | null)?.files?.[0];
        if (file && file.size > MAX_UPLOAD_BYTES) {
          event.preventDefault();
          setTooLarge('Arquivo maior que 5 MB.');
          return;
        }
        setTooLarge(null);
      }}
      className="flex flex-col gap-3 rounded-xl border p-4"
    >
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

      {tooLarge && <p role="alert" className="text-sm text-red-700">{tooLarge}</p>}
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state?.notice && <p role="status" className="text-sm text-amber-700">{state.notice}</p>}
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
