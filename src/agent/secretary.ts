import { convertToModelMessages, stepCountIs, streamText, tool } from 'ai';
import type { LanguageModel, UIMessage } from 'ai';
import { z } from 'zod';
import type { Embedder } from '@/ai/embedder';
import { CHAT_MODEL } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import { searchKnowledgeBase } from '@/core/retrieval';
import type { Db } from '@/db/client';
import { listUpcomingEvents } from '@/db/repo/events';
import { createPrayerRequest } from '@/db/repo/prayer';
import { createTicket } from '@/db/repo/tickets';

export type SecretaryDeps = { db: Db; embedder: Embedder; model?: LanguageModel };
export type SecretaryInput = {
  churchId: string;
  churchName: string;
  conversationId: string;
  uiMessages: UIMessage[];
};

function systemPrompt(churchName: string): string {
  return [
    `You are the virtual secretary ("Secretária Virtual") of ${churchName}, a Brazilian church.`,
    'Always reply in the language the visitor writes in. Church content is in Portuguese; translate naturally when needed.',
    'Ground every factual claim about the church (schedules, addresses, events, ministries, contacts) in results from the searchKnowledge or getCalendar tools. If the tools do not support an answer, say you do not know and offer to connect the visitor with a person. Never invent facts.',
    'When a visitor shares a prayer need and wants the church to pray, use createPrayerRequest (ask for their name, but it is optional).',
    'When the visitor asks for a human, or you cannot help after searching, use escalateToHuman.',
    'Keep answers short, warm, and practical. Do not give pastoral counseling, medical, legal, or financial advice — offer escalation instead.',
    'This is a public demo of a fictional church; if asked, be transparent about that.',
  ].join('\n');
}

export function secretaryTools(deps: SecretaryDeps, ctx: { churchId: string; conversationId: string }) {
  return {
    searchKnowledge: tool({
      description: 'Search the church knowledge base (schedules, bulletins, ministries, FAQs). Returns source excerpts to cite.',
      inputSchema: z.object({ query: z.string().describe('Search query in Portuguese') }),
      execute: async ({ query }) => {
        const { sources, embeddingTokens } = await searchKnowledgeBase(deps.db, deps.embedder, ctx.churchId, query);
        // A ledger write failing here must not discard a successful search: the visitor
        // still gets a grounded answer, and we just lose one usage record instead of
        // falsely claiming "I don't know" on top of an unrelated infra hiccup.
        try {
          await recordUsage(deps.db, {
            churchId: ctx.churchId,
            feature: 'chat.retrieval',
            model: deps.embedder.model,
            inputTokens: embeddingTokens,
            outputTokens: 0,
          });
        } catch (err) {
          console.error('searchKnowledge: failed to record usage ledger entry', {
            churchId: ctx.churchId,
            conversationId: ctx.conversationId,
            model: deps.embedder.model,
            embeddingTokens,
            error: err,
          });
        }
        return { sources };
      },
    }),
    getCalendar: tool({
      description: 'List the next upcoming church events with dates and locations.',
      inputSchema: z.object({}),
      execute: async () => ({ events: await listUpcomingEvents(deps.db, ctx.churchId, 10) }),
    }),
    createPrayerRequest: tool({
      description: 'Save a prayer request for the church intercession team.',
      inputSchema: z.object({
        request: z.string().describe('The prayer need, in the visitor’s words'),
        name: z.string().optional().describe('Visitor name, if given'),
      }),
      execute: async ({ request, name }) => {
        await createPrayerRequest(deps.db, { churchId: ctx.churchId, conversationId: ctx.conversationId, request, name });
        return { saved: true };
      },
    }),
    escalateToHuman: tool({
      description: 'Open a ticket for the church staff to contact the visitor personally.',
      inputSchema: z.object({ topic: z.string().describe('Short summary of what the visitor needs') }),
      execute: async ({ topic }) => {
        const ticket = await createTicket(deps.db, { churchId: ctx.churchId, conversationId: ctx.conversationId, topic });
        return { ticketId: ticket.id, note: 'Staff will follow up in this conversation.' };
      },
    }),
  };
}

export async function runSecretary(deps: SecretaryDeps, input: SecretaryInput) {
  return streamText({
    model: deps.model ?? CHAT_MODEL,
    system: systemPrompt(input.churchName),
    messages: await convertToModelMessages(input.uiMessages),
    tools: secretaryTools(deps, { churchId: input.churchId, conversationId: input.conversationId }),
    stopWhen: stepCountIs(5),
    onFinish: async ({ usage }) => {
      await recordUsage(deps.db, {
        churchId: input.churchId,
        feature: 'chat.reply',
        model: CHAT_MODEL,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      });
    },
  });
}
