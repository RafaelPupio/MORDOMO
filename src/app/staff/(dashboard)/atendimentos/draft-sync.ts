/**
 * Moves the reply textarea onto a NEW AI draft, but only while the staff member has not
 * started editing — "current text still equals the last draft they were shown".
 *
 * The order of the two statements is the whole point. The first version of this logic
 * lived inline in ticket-card.tsx as
 *
 *     setReplyText((current) => (current === lastDraftRef.current ? draft : current));
 *     lastDraftRef.current = draft;
 *
 * React applies a functional updater LAZILY — on the next render, not when it is queued —
 * and by then the ref already held the new draft, so the comparison was `'' === newDraft`,
 * false, and the textarea kept its old (empty) text. In production the staff member saw
 * "Rascunho da IA — revise antes de enviar" and five sources above an empty box
 * (2026-09-05). The previous draft has to be captured BEFORE the ref moves on, and the
 * updater has to close over that captured value.
 *
 * Kept as a plain function so the ordering is testable with a deferred fake setter (see
 * tests/app/staff/(dashboard)/atendimentos/draft-sync.test.ts) — there is no DOM test
 * environment in this repo.
 */
export function syncDraft(
  lastDraftRef: { current: string },
  draft: string,
  setReplyText: (updater: (current: string) => string) => void,
): void {
  const previous = lastDraftRef.current;
  if (draft === previous) return;
  lastDraftRef.current = draft;
  setReplyText((current) => (current === previous ? draft : current));
}
