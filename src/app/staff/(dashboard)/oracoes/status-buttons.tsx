'use client';

import { useActionState } from 'react';
import type { PrayerStatus } from '@/db/repo/prayer';
import { updatePrayerStatus, type PrayerStatusState } from './actions';

const STATUS_LABEL: Record<PrayerStatus, string> = { new: 'Nova', praying: 'Orando', done: 'Concluída' };
const STATUS_ORDER: readonly PrayerStatus[] = ['new', 'praying', 'done'];
const INITIAL: PrayerStatusState = {};

// Client component so `updatePrayerStatus` can report a controlled error (I1) instead of
// the page just silently failing to update — `oracoes/page.tsx` stays a server component
// and passes down only the two primitives this needs.
export function PrayerStatusButtons({ id, status }: { id: string; status: string }) {
  const [state, action, pending] = useActionState(updatePrayerStatus, INITIAL);

  return (
    <div className="mt-3 flex flex-col gap-1">
      <div className="flex gap-2">
        {STATUS_ORDER.map((s) => (
          <form key={s} action={action}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value={s} />
            <button
              type="submit"
              disabled={pending || status === s}
              className="rounded-lg border px-3 py-1 text-xs font-medium disabled:cursor-default disabled:opacity-40"
            >
              {STATUS_LABEL[s]}
            </button>
          </form>
        ))}
      </div>
      {state.error && <p role="alert" className="text-xs text-red-700">{state.error}</p>}
    </div>
  );
}
