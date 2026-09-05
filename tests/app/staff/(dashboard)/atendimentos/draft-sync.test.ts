import { describe, expect, it } from 'vitest';
import { syncDraft } from '@/app/staff/(dashboard)/atendimentos/draft-sync';

// React applies a functional state updater on the NEXT render, not when it is queued. This
// fake setter reproduces that: it stores updaters and only runs them when `flush()` is
// called, after the code under test has returned — which is exactly when the buggy
// ordering (advance the ref, then let the updater read it) went wrong.
function deferredState(initial: string) {
  let value = initial;
  const queue: Array<(current: string) => string> = [];
  return {
    set: (updater: (current: string) => string) => { queue.push(updater); },
    flush: () => { for (const u of queue.splice(0)) value = u(value); return value; },
    get: () => value,
  };
}

describe('syncDraft', () => {
  it('lands a fresh draft on an untouched textarea even though the updater runs late', () => {
    const ref = { current: '' };
    const state = deferredState('');

    syncDraft(ref, 'Olá Carla, ...', state.set);
    expect(ref.current).toBe('Olá Carla, ...');   // the ref has already moved on...
    expect(state.flush()).toBe('Olá Carla, ...'); // ...and the draft still lands
  });

  it('follows a second, different draft while the text is still the first draft', () => {
    const ref = { current: '' };
    const state = deferredState('');
    syncDraft(ref, 'primeira sugestão', state.set);
    state.flush();

    syncDraft(ref, 'segunda sugestão', state.set);
    expect(state.flush()).toBe('segunda sugestão');
  });

  it('keeps an in-progress edit when a new draft arrives', () => {
    const ref = { current: 'primeira sugestão' };
    const state = deferredState('primeira sugestão, editada pela secretária');

    syncDraft(ref, 'segunda sugestão', state.set);
    expect(state.flush()).toBe('primeira sugestão, editada pela secretária');
    expect(ref.current).toBe('segunda sugestão');
  });

  it('does nothing when the draft has not changed', () => {
    const ref = { current: 'mesma' };
    let calls = 0;
    syncDraft(ref, 'mesma', () => { calls++; });
    expect(calls).toBe(0);
  });
});
