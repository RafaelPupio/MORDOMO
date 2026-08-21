import type { Source } from '@/core/retrieval';
import type { SuggestTicketReplyResult } from '@/core/staff-operations';

export type SuggestReplyState = { reply?: string; sources?: Source[]; error?: string; notice?: string };

/**
 * Turns one `suggestTicketReply` outcome into the next client-visible state, given whatever
 * was already on screen (`prevState`, as `useActionState` hands it to the action). Kept as a
 * plain function — not exported from `actions.ts` itself — for two reasons: a `'use server'`
 * file may only export async Server Actions, and keeping this pure (no `requireStaffContext`
 * / `getDb`) makes the exact "stale draft, don't blank the sources" behavior (I2) directly
 * unit-testable without mocking Next.js request context.
 */
export function buildSuggestReplyState(
  prevState: SuggestReplyState,
  result: SuggestTicketReplyResult,
): SuggestReplyState {
  if (result.generated) return { reply: result.reply, sources: result.sources };

  if (result.reply) {
    // A fresh generation failed (or nothing new came back), but a previously saved draft
    // still exists. Say so plainly instead of quietly reusing old text as if the retry had
    // worked, and keep whichever sources were already on screen for that same draft rather
    // than blanking them — the drafter's fallback path never returns sources of its own, so
    // trusting it here would make the grounding list disappear on every retry even though
    // the draft text hasn't changed.
    return {
      reply: result.reply,
      sources: prevState.sources && prevState.sources.length > 0 ? prevState.sources : result.sources,
      notice: 'Não foi possível gerar uma nova sugestão agora. O rascunho anterior foi mantido.',
    };
  }

  return { error: 'Não foi possível gerar uma sugestão agora. Escreva a resposta manualmente abaixo.' };
}
