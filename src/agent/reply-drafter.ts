import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { Embedder } from '@/ai/embedder';
import { FAST_MODEL, priceableModelId } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import { searchKnowledgeBase, type Source } from '@/core/retrieval';
import type { Db } from '@/db/client';

export type ReplyDrafterDeps = { db: Db; embedder: Embedder; model?: LanguageModel };
export type ReplyDrafterInput = {
  churchId: string;
  churchName: string;
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
  const { sources, embeddingTokens } = await searchKnowledgeBase(
    deps.db, deps.embedder, input.churchId, input.topic,
  );

  try {
    await recordUsage(deps.db, {
      churchId: input.churchId, feature: 'support.retrieval',
      model: deps.embedder.model, inputTokens: embeddingTokens, outputTokens: 0,
    });
  } catch (error) {
    console.error('support.retrieval usage not recorded', { ticketId: input.ticketId, error });
  }

  const grounding = sources.length
    ? sources.map((s) => `- ${s.documentTitle}: ${s.excerpt}`).join('\n')
    : '(nada encontrado na base de conhecimento)';

  try {
    const { text, usage } = await generateText({
      model: deps.model ?? FAST_MODEL,
      system: [
        `You draft replies for the secretary of ${input.churchName}, a Brazilian church.`,
        'Write in Brazilian Portuguese, warm and brief — two or three sentences.',
        'Use ONLY the church information provided below. If it does not answer the question, say plainly that you will check and get back to them; never invent a fact.',
        'This is a DRAFT a staff member will read, edit, and send. Do not sign it, and do not promise anything the church has not stated.',
      ].join('\n'),
      prompt: [
        `ASSUNTO: ${input.topic}`,
        input.conversationExcerpt ? `\nCONVERSA:\n${input.conversationExcerpt}` : '',
        `\nINFORMAÇÕES DA IGREJA:\n${grounding}`,
      ].join('\n'),
    });

    try {
      await recordUsage(deps.db, {
        churchId: input.churchId, feature: 'support.draft',
        model: priceableModelId(deps.model ?? FAST_MODEL, FAST_MODEL),
        inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0,
      });
    } catch (error) {
      console.error('support.draft usage not recorded', { ticketId: input.ticketId, error });
    }

    return { reply: text, sources };
  } catch (error) {
    console.error('support.draft failed; returning an empty draft', {
      churchId: input.churchId, ticketId: input.ticketId, error,
    });
    return { reply: '', sources };
  }
}
