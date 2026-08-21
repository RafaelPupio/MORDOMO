'use client';

import { useActionState } from 'react';
import { generateReportNow } from './actions';
import type { GenerateReportState } from './generate-report-state';

const INITIAL_STATE: GenerateReportState = {};

// Client component so `generateReportNow` can report a controlled outcome (I1, mirroring
// `PrayerStatusButtons`/`UploadForm`) instead of the page silently doing nothing — and so
// the three outcomes `buildGenerateReportState` distinguishes (published / skipped / failed)
// each get their own, differently-styled line rather than collapsing into one generic
// message. `revalidatePath('/staff/relatorios')` inside the action is what makes a
// `published` outcome's new report actually appear below without a manual refresh.
export function GenerateReportButton() {
  const [state, action, pending] = useActionState(generateReportNow, INITIAL_STATE);

  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Gerando…' : 'Gerar agora'}
      </button>
      <p className="text-xs text-neutral-500">
        Gera o resumo da semana passada sob demanda, sem esperar a segunda-feira.
      </p>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.notice && <p role="status" className="text-sm text-amber-700">{state.notice}</p>}
      {state.ok && <p role="status" className="text-sm text-emerald-700">{state.ok}</p>}
    </form>
  );
}
