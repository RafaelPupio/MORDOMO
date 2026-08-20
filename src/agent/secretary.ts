import { convertToModelMessages, stepCountIs, streamText, tool } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { Embedder } from '@/ai/embedder';
import { CHAT_MODEL } from '@/ai/pricing';
import { recordUsage } from '@/ai/usage';
import type { IncomingChat } from '@/core/channel';
import { searchKnowledgeBase } from '@/core/retrieval';
import type { Db } from '@/db/client';
import { listUpcomingEvents } from '@/db/repo/events';
import { createPrayerRequest } from '@/db/repo/prayer';
import { createTicket } from '@/db/repo/tickets';

export type SecretaryDeps = { db: Db; embedder: Embedder; model?: LanguageModel };
// The agent's input IS the channel envelope (IncomingChat) plus the one piece of context
// no transport can supply on its own: the display name to greet the visitor with. Every
// adapter (web today, WhatsApp later) constructs an IncomingChat and hands it here —
// see src/core/channel.ts for what that seam is and isn't responsible for.
export type SecretaryInput = IncomingChat & { churchName: string };

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

// `deps.model` can be a plain model-id string (the production default, or a real override)
// or a LanguageModel OBJECT (e.g. MockLanguageModelV3 in tests) — an object has no id to
// look up a price by, so pricing falls back to CHAT_MODEL in that case. Without this,
// usage was always priced under CHAT_MODEL even when a string override was in play, silently
// mispricing every call made under the override. Exported so tests can assert this decision
// directly, without needing to route a real (network-resolving) string model id through
// streamText just to observe which id its usage got priced under.
export function priceableModelId(model: LanguageModel): string {
  return typeof model === 'string' ? model : CHAT_MODEL;
}

export async function runSecretary(deps: SecretaryDeps, input: SecretaryInput) {
  const model = deps.model ?? CHAT_MODEL;
  const pricedModel = priceableModelId(model);
  return streamText({
    model,
    system: systemPrompt(input.churchName),
    messages: await convertToModelMessages(input.uiMessages),
    tools: secretaryTools(deps, { churchId: input.churchId, conversationId: input.conversationId }),
    stopWhen: stepCountIs(5),
    onFinish: async ({ usage }) => {
      // Mirrors the searchKnowledge tool's ledger-write guard above — a failed insert must
      // not crash a chat reply that has already streamed to the visitor. Unlike that
      // sibling call, this is the expensive half of every turn's cost; swallowing it without
      // logging (as this used to) makes budget under-counting both permanent (the record
      // never happens) and invisible (nothing anywhere says it didn't).
      try {
        await recordUsage(deps.db, {
          churchId: input.churchId,
          feature: 'chat.reply',
          model: pricedModel,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        });
      } catch (err) {
        console.error('runSecretary: failed to record usage ledger entry', {
          churchId: input.churchId,
          conversationId: input.conversationId,
          model: pricedModel,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          error: err,
        });
      }
    },
  });
}
