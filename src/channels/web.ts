import type { UIMessage } from 'ai';
import { z } from 'zod';
import { checkBudget } from '@/ai/usage';
import { runSecretary, type SecretaryDeps } from '@/agent/secretary';
import { checkRateLimit } from '@/core/rate-limit';
import { ensureConversation, getConversation, saveMessage } from '@/db/repo/chat';
import { DEMO_CHURCH_SLUG, getChurchBySlug } from '@/db/repo/churches';

export type WebChannelDeps = SecretaryDeps & { globalCapUsd: number };

const VISITOR_COOKIE_NAME = 'ccb_visitor';

// F4: cap what one request's history can cost. `messages` is entirely client-supplied on
// this public, unauthenticated endpoint, and the budget gate above only bounds spend
// *between* requests — it cannot bound the size of a single one. These caps are demo-scale
// sanity limits, not a real conversation-length product decision.
const MAX_MESSAGES = 50;
const MAX_TOTAL_CHARS = 24_000;

// F3: each part is one AI SDK UIMessage part (text, tool-call, file, reasoning, ...). Only
// the shared discriminant (`type`) is validated here; unknown extra fields are allowed
// through (`.passthrough()`) since part shapes vary by type and the AI SDK's own message
// conversion is the real authority on their structure. What matters for this endpoint is
// that `parts` is always an array of objects, never a bare string or missing entirely.
const messagePartSchema = z.object({ type: z.string() }).passthrough();

const messageSchema = z.object({
  id: z.string().optional(),
  // Only the two roles this endpoint ever accepts from a client. `system` is never
  // client-supplied — it comes from the server-side prompt in src/agent/secretary.ts.
  role: z.enum(['user', 'assistant']),
  parts: z.array(messagePartSchema),
}).passthrough();

function totalMessageChars(messages: readonly z.infer<typeof messageSchema>[]): number {
  let total = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') total += text.length;
    }
  }
  return total;
}

const bodySchema = z
  .object({
    messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
    conversationId: z.uuid(),
  })
  .refine((body) => totalMessageChars(body.messages) <= MAX_TOTAL_CHARS, {
    message: 'history exceeds the character budget',
  });

const CHAT_LIMIT = { limit: 20, windowSeconds: 600 };

function parseCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function serializeVisitorCookie(value: string): string {
  const attrs = [`${VISITOR_COOKIE_NAME}=${value}`, 'HttpOnly', 'SameSite=Lax', 'Path=/'];
  // Secure requires HTTPS; local dev over plain HTTP would otherwise never receive the
  // cookie back from the browser. Every other environment (including test, which is not
  // "development") gets it.
  if (process.env.NODE_ENV !== 'development') attrs.push('Secure');
  return attrs.join('; ');
}

// F1: conversation ownership must rest on a value the caller cannot choose. A cookie the
// server mints and marks httpOnly is that value — unlike a request header, the visitor's
// own JS can't read or set it, and unlike an IP-derived key, an attacker can't spoof it
// onto themselves. A first-time visitor (no cookie, or a cookie that isn't a UUID we could
// have minted) gets a freshly minted one; everyone else keeps theirs.
function resolveVisitorId(req: Request): { visitorId: string; mintedCookieHeader?: string } {
  const existing = parseCookie(req, VISITOR_COOKIE_NAME);
  if (existing && z.uuid().safeParse(existing).success) {
    return { visitorId: existing };
  }
  const visitorId = crypto.randomUUID();
  return { visitorId, mintedCookieHeader: serializeVisitorCookie(visitorId) };
}

// F2: rate-limit identity is best-effort and separate from conversation ownership — it
// only needs to make abuse *expensive* to spread across identities, not prove who someone
// is. Trust assumption: `x-real-ip` and `x-vercel-forwarded-for` are set by the platform
// itself (Vercel), not forwarded verbatim from the client, so they're not attacker-
// controlled the way a bare `x-forwarded-for` is. `x-forwarded-for` is a comma-separated
// hop chain where the LEFTMOST entry is whatever the client claimed and the RIGHTMOST
// entry is the hop nearest us — we take the rightmost as the least-spoofable guess. If
// none of these headers are present, every caller falls back to their own visitor cookie
// rather than a shared constant, so header-less callers still get separate buckets (F2).
function resolveRateLimitIdentity(req: Request, visitorId: string): string {
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  const vercelForwardedFor = req.headers.get('x-vercel-forwarded-for');
  if (vercelForwardedFor) return vercelForwardedFor.trim();

  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const hops = forwardedFor.split(',').map((hop) => hop.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  return visitorId;
}

export async function handleChatRequest(deps: WebChannelDeps, req: Request): Promise<Response> {
  const { visitorId, mintedCookieHeader } = resolveVisitorId(req);

  // Every response — including the early-return error paths below — carries the minted
  // cookie when one was minted, so a first-time visitor is identified even if their very
  // first request gets rejected.
  const jsonResponse = (body: unknown, init: { status: number }): Response => {
    const res = Response.json(body, init);
    if (mintedCookieHeader) res.headers.append('Set-Cookie', mintedCookieHeader);
    return res;
  };

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonResponse({ code: 'bad_request' }, { status: 400 });
  }

  // F3: everything below has consumed a rate-limit slot and, once ensureConversation runs,
  // can write rows — an unexpected failure here must never leak a stack trace or raw SQL
  // to the client. Validation itself (the parse above) is intentionally outside this
  // try/catch so a 400 for a malformed body stays a 400, not a 500.
  try {
    const church = await getChurchBySlug(deps.db, DEMO_CHURCH_SLUG);
    if (!church) return jsonResponse({ code: 'not_seeded' }, { status: 500 });

    // A2: scope the rate-limit key by tenant. `rate_limits` is a tenant-agnostic table
    // keyed by an opaque string, so the tenant must live in the key itself — otherwise
    // visitors of different churches would share one counter.
    const rateLimitId = resolveRateLimitIdentity(req, visitorId);
    const rate = await checkRateLimit(deps.db, `chat:${church.id}:${rateLimitId}`, CHAT_LIMIT);
    if (!rate.allowed) return jsonResponse({ code: 'rate_limited' }, { status: 429 });

    const budget = await checkBudget(deps.db, church.id, deps.globalCapUsd);
    if (!budget.allowed) return jsonResponse({ code: 'budget_exhausted', reason: budget.reason }, { status: 402 });

    await ensureConversation(deps.db, { id: body.conversationId, churchId: church.id, visitorKey: visitorId });

    // A3/F1: ensureConversation uses onConflictDoNothing, so a client-supplied
    // conversationId that already belongs to someone else silently no-ops the insert
    // instead of erroring. Load the row as it actually exists and verify it belongs to
    // this church AND this cookie-identified visitor before letting the request read or
    // append to it.
    const conversation = await getConversation(deps.db, body.conversationId);
    if (!conversation || conversation.churchId !== church.id || conversation.visitorKey !== visitorId) {
      return jsonResponse({ code: 'conversation_forbidden' }, { status: 403 });
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

    const streamHeaders = new Headers();
    if (mintedCookieHeader) streamHeaders.append('Set-Cookie', mintedCookieHeader);

    return result.toUIMessageStreamResponse({
      headers: streamHeaders,
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
  } catch (err) {
    console.error('handleChatRequest: unexpected failure', { conversationId: body.conversationId, error: err });
    return jsonResponse({ code: 'internal_error' }, { status: 500 });
  }
}
