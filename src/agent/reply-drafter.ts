import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { Embedder } from '@/ai/embedder';
import { FAST_MODEL, priceableModelId } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import { searchKnowledgeBase, type Source } from '@/core/retrieval';
import type { Db } from '@/db/client';

export type ReplyDrafterDeps = { db: Db; embedder: Embedder; model?: LanguageModel };
export type ReplyDrafterInput = {
  organizationId: string;
  organizationName: string;
  ticketId: string;
  topic: string;
  conversationExcerpt?: string;
};

/**
 * Drafts a reply for a staff member to EDIT and send — it is never sent automatically.
 * That is why a model failure returns an empty draft rather than throwing: the staff
 * member can always write the reply themselves, and a broken drafter must not block the
 * inbox.
 */
export async function draftReply(
  deps: ReplyDrafterDeps,
  input: ReplyDrafterInput,
): Promise<{ reply: string; sources: Source[] }> {
  // Hoist model selection so it's computed once
  const model = deps.model ?? FAST_MODEL;

  // Wrap retrieval in its own try/catch. If the embedder fails (network, timeout, etc.),
  // we log it but continue with an empty grounding. The model prompt already instructs
  // the model to say "I'll check and get back to you" when given no information, so the
  // staff member gets a sensible draft to work from rather than a complete failure that
  // blocks the inbox. The failure is logged for monitoring and debugging.
  let sources: Source[] = [];
  let embeddingTokens = 0;
  let retrievalSucceeded = true;
  try {
    ({ sources, embeddingTokens } = await searchKnowledgeBase(
      deps.db, deps.embedder, input.organizationId, input.topic,
    ));
  } catch (error) {
    retrievalSucceeded = false;
    console.error('support.retrieval failed; continuing with empty grounding', {
      organizationId: input.organizationId, ticketId: input.ticketId, error,
    });
  }

  // Record retrieval only if it actually ran (even if it found nothing, we still record).
  // A failed retrieval must not write a phantom $0 row to usage_ledger.
  if (retrievalSucceeded) {
    try {
      await recordUsage(deps.db, {
        organizationId: input.organizationId, feature: 'support.retrieval',
        model: deps.embedder.model, inputTokens: embeddingTokens, outputTokens: 0,
      });
    } catch (error) {
      console.error('support.retrieval usage not recorded', { ticketId: input.ticketId, error });
    }
  }

  const grounding = sources.length
    ? sources.map((s) => `- ${s.documentTitle}: ${s.excerpt}`).join('\n')
    : '(nada encontrado na base de conhecimento)';

  try {
    const { text, usage } = await generateText({
      model,
      system: [
        `You draft replies for the secretary of ${input.organizationName}, a Brazilian church.`,
        'Write in Brazilian Portuguese, warm and brief — two or three sentences.',
        'Use ONLY the church information provided below. If it does not answer the question, say plainly that you will check and get back to them; never invent a fact.',
        'This is a DRAFT a staff member will read, edit, and send. Do not sign it, and do not promise anything the church has not stated.',
        'Reply with the message text only — no preamble, labels, or meta-commentary.',
      ].join('\n'),
      prompt: [
        `ASSUNTO: ${input.topic}`,
        input.conversationExcerpt ? `\nCONVERSA:\n${input.conversationExcerpt}` : '',
        `\nINFORMAÇÕES DA IGREJA:\n${grounding}`,
      ].join('\n'),
    });

    try {
      await recordUsage(deps.db, {
        organizationId: input.organizationId, feature: 'support.draft',
        model: priceableModelId(model, FAST_MODEL),
        inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0,
      });
    } catch (error) {
      console.error('support.draft usage not recorded', { ticketId: input.ticketId, error });
    }

    // Trim the reply and treat whitespace-only output as empty.
    const trimmedReply = text.trim();
    return { reply: trimmedReply, sources };
  } catch (error) {
    console.error('support.draft failed; returning an empty draft', {
      organizationId: input.organizationId, ticketId: input.ticketId, error,
    });
    return { reply: '', sources };
  }
}
