import type { UIMessage } from 'ai';
import { z } from 'zod';
import { checkBudget } from '@/ai/usage';
import { runSecretary, type SecretaryDeps } from '@/agent/secretary';
import { checkRateLimit } from '@/core/rate-limit';
import { ensureConversation, getConversation, saveMessage } from '@/db/repo/chat';
import { DEMO_CHURCH_SLUG, getChurchBySlug } from '@/db/repo/churches';

export type WebChannelDeps = SecretaryDeps & { globalCapUsd: number };

const bodySchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).min(1),
  conversationId: z.uuid(),
});

const CHAT_LIMIT = { limit: 20, windowSeconds: 600 };

export async function handleChatRequest(deps: WebChannelDeps, req: Request): Promise<Response> {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ code: 'bad_request' }, { status: 400 });
  }

  const church = await getChurchBySlug(deps.db, DEMO_CHURCH_SLUG);
  if (!church) return Response.json({ code: 'not_seeded' }, { status: 500 });

  const visitorKey = (req.headers.get('x-forwarded-for') ?? 'anon').split(',')[0].trim();

  // A2: scope the rate-limit key by tenant. `rate_limits` is a tenant-agnostic table
  // keyed by an opaque string, so the tenant must live in the key itself — otherwise
  // visitors of different churches would share one counter.
  const rate = await checkRateLimit(deps.db, `chat:${church.id}:${visitorKey}`, CHAT_LIMIT);
  if (!rate.allowed) return Response.json({ code: 'rate_limited' }, { status: 429 });

  const budget = await checkBudget(deps.db, church.id, deps.globalCapUsd);
  if (!budget.allowed) return Response.json({ code: 'budget_exhausted', reason: budget.reason }, { status: 402 });

  await ensureConversation(deps.db, { id: body.conversationId, churchId: church.id, visitorKey });

  // A3: ensureConversation uses onConflictDoNothing, so a client-supplied conversationId
  // that already belongs to someone else silently no-ops the insert instead of erroring.
  // Load the row as it actually exists and verify it belongs to this church AND this
  // visitor before letting the request read or append to it.
  const conversation = await getConversation(deps.db, body.conversationId);
  if (!conversation || conversation.churchId !== church.id || conversation.visitorKey !== visitorKey) {
    return Response.json({ code: 'conversation_forbidden' }, { status: 403 });
  }

  const uiMessages = body.messages as unknown as UIMessage[];
  const last = uiMessages[uiMessages.length - 1];
  if (last?.role === 'user') {
    await saveMessage(deps.db, { churchId: church.id, conversationId: body.conversationId, role: 'user', parts: last.parts });
  }

  // A1: convertToModelMessages is async in ai@7.0.68, so runSecretary returns a Promise.
  const result = await runSecretary(deps, {
    churchId: church.id,
    churchName: church.name,
    conversationId: body.conversationId,
    uiMessages,
  });

  return result.toUIMessageStreamResponse({
    // `onFinish` is deprecated in ai@7.0.68 in favor of `onEnd` (identical signature,
    // including `responseMessage`) — using the non-deprecated name here.
    onEnd: async ({ responseMessage }) => {
      await saveMessage(deps.db, {
        churchId: church.id,
        conversationId: body.conversationId,
        role: 'assistant',
        parts: responseMessage.parts,
      });
    },
  });
}
