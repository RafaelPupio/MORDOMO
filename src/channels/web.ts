import type { UIMessage } from 'ai';
import { z } from 'zod';
import { checkBudget } from '@/ai/usage';
import { runSecretary, type SecretaryDeps } from '@/agent/secretary';
import type { IncomingChat } from '@/core/channel';
import { checkRateLimit } from '@/core/rate-limit';
import type { Db } from '@/db/client';
import {
  ensureConversation, getConversation, getConversationByVisitor, listMessages, saveMessage,
} from '@/db/repo/chat';
import { DEMO_CHURCH_SLUG, getChurchBySlug } from '@/db/repo/churches';

export type WebChannelDeps = SecretaryDeps & { globalCapUsd: number };

const VISITOR_COOKIE_NAME = 'ccb_visitor';

// `messages` is entirely client-supplied on this public, unauthenticated endpoint, and the
// budget gate above only bounds spend *between* requests — it cannot bound the size of a
// single one. Three separate bounds guard three different failure modes; they must not be
// conflated into one "over budget -> 400" rule:
//
// - HISTORY_ABUSE_MAX_CHARS is a hard ceiling on the whole request's serialized size. It
//   exists purely to stop a request from being made *expensive* (JSON parsing, DB writes,
//   model context) — crossing it is treated as abuse and rejected with 400, before any
//   database write, exactly like a malformed body. It is set far above anything a real
//   conversation reaches, so it never fires on ordinary use.
// - MODEL_HISTORY_CHARS bounds what actually gets sent to the model. A long, honest
//   conversation legitimately grows past this size — a grounded reply carries cited source
//   excerpts, and those add up over many turns — without being abusive in any way. Rejecting
//   those requests outright would break the chat permanently for anyone who talked long
//   enough: once history crossed this figure, every subsequent turn would 400, because the
//   client keeps resending the whole growing history. Instead, the history sent to the
//   *model* is silently trimmed to the most recent messages that fit — the client still gets
//   a normal 200 and a reply; only the model's context loses old turns. This is what a real
//   product does: forget old history, don't break the conversation.
// - A single oversized message needs its own rule. trimHistoryForModel deliberately always
//   keeps the newest message whole — the user's current turn must never be trimmed away —
//   which means a single oversized newest message would otherwise walk straight past
//   MODEL_HISTORY_CHARS and reach the model at up to HISTORY_ABUSE_MAX_CHARS, more than ten
//   times the budget the trimming step exists to enforce. So this is a validation rule, not
//   a trimming rule: `inspectMessages` (below) also tracks the largest single message's
//   serialized size, and `bodySchema`'s `.refine()` rejects the request with 400 when that
//   alone exceeds MODEL_HISTORY_CHARS — before any database write, alongside the other
//   bounds. A legitimate chat turn is a message, not a document; a single turn larger than
//   the entire model-history budget is abuse, and silently truncating a user's own current
//   message would be worse than rejecting it outright.
//
// Put together, these three bounds guarantee the model can never receive more than
// ~MODEL_HISTORY_CHARS of history in one request:
//   - one message > MODEL_HISTORY_CHARS               -> 400
//   - whole request > HISTORY_ABUSE_MAX_CHARS          -> 400
//   - otherwise: history is silently trimmed down to MODEL_HISTORY_CHARS, request proceeds 200
//
// MAX_MESSAGES is a coarse, cheap pre-filter on message *count* (checked by zod before any
// serialization happens), so an absurdly long messages array can't force the server to pay
// JSON.stringify cost on all of it. It must stay comfortably above the message count a
// legitimate long conversation reaches before HISTORY_ABUSE_MAX_CHARS would fire — otherwise
// it would 400 an honest conversation for a reason that has nothing to do with abuse. (50
// was too low: a realistic grounded turn runs ~3,100 characters, so 50 messages — 25 turns —
// arrives at ~78,000 characters, nowhere near HISTORY_ABUSE_MAX_CHARS.)
// Exported so tests can assert against the actual bounds instead of duplicating magic
// numbers that could silently drift out of sync with this file.
export const MAX_MESSAGES = 500;
export const HISTORY_ABUSE_MAX_CHARS = 256_000;
export const MODEL_HISTORY_CHARS = 24_000;

// Each part is one AI SDK UIMessage part (text, tool-call, file, reasoning, ...). Only the
// shared discriminant (`type`) is validated here; unknown extra fields are allowed through
// (`.passthrough()`) since part shapes vary by type and the AI SDK's own message conversion
// is the real authority on their structure. What matters for this endpoint is that `parts`
// is always an array of objects, never a bare string or missing entirely.
const messagePartSchema = z.object({ type: z.string() }).passthrough();

const messageSchema = z.object({
  id: z.string().optional(),
  // Only the two roles this endpoint ever accepts from a client. `system` is never
  // client-supplied — it comes from the server-side prompt in src/agent/secretary.ts.
  role: z.enum(['user', 'assistant']),
  parts: z.array(messagePartSchema),
}).passthrough();

// The cap runs on each message's SERIALIZED size, not on its text fields alone: summing
// only `part.text` misses any other part shape — a tool-call/tool-result part, a `file`
// part with a `data:` URL, or even a stray passthrough field sitting next to a real `text`
// field — leaving it invisible to the budget while it still reaches the model *and* gets
// persisted verbatim into the `messages.parts` jsonb column (saveMessage stores the parsed
// `parts` array as-is).
//
// A message whose serialized text contains a raw NUL character or an unpaired ("lone")
// UTF-16 surrogate is syntactically valid JSON but Postgres refuses to store either in a
// jsonb column — left unchecked, that rejection would surface as an uncaught 500 *after*
// `ensureConversation` had already written a `conversations` row for the request. Both
// checks are folded into the one per-message `JSON.stringify` pass below (via its replacer
// callback) so a request is never serialized twice just to validate it.
//
// This also returns `maxMessageChars`, the largest single message's serialized size seen so
// far, so `bodySchema`'s `.refine()` can reject a request whose newest (or any) message
// alone exceeds MODEL_HISTORY_CHARS — the one case `trimHistoryForModel`'s "always keep the
// newest message whole" rule cannot protect against, since it never rejects. This is the ONE
// place MODEL_HISTORY_CHARS is used as a rejection bound; the aggregate multi-message case
// (many small messages whose TOTAL exceeds MODEL_HISTORY_CHARS) is still handled by silent
// trimming, never rejection. See the comment above the constants for how the three bounds
// fit together.
//
// `maxMessageChars` is updated for each message BEFORE the early-break check below, so the
// message that pushes `totalChars` over HISTORY_ABUSE_MAX_CHARS still has its own size
// recorded — it cannot "escape" the per-message check just because the loop exits right
// after it. (Messages after the break are never inspected, but that's fine: the request is
// already rejected via `totalChars`, regardless of what `maxMessageChars` would have been.)
function inspectMessages(
  msgs: readonly z.infer<typeof messageSchema>[],
): { totalChars: number; hasInvalidChars: boolean; maxMessageChars: number } {
  let totalChars = 0;
  let hasInvalidChars = false;
  let maxMessageChars = 0;
  for (const message of msgs) {
    const serialized = JSON.stringify(message, (_key, value) => {
      // `String.prototype.isWellFormed()` (ES2024) is false exactly for strings holding an
      // unpaired surrogate. NUL is well-formed UTF-16 but still unstorable, so it needs its
      // own check.
      if (typeof value === 'string' && (value.includes('\u0000') || !value.isWellFormed())) {
        hasInvalidChars = true;
      }
      return value;
    });
    totalChars += serialized.length;
    if (serialized.length > maxMessageChars) maxMessageChars = serialized.length;
    // Already over budget: the request is rejected regardless of what's left, so there's
    // no need to keep serializing the remaining messages.
    if (totalChars > HISTORY_ABUSE_MAX_CHARS) break;
  }
  return { totalChars, hasInvalidChars, maxMessageChars };
}

// Trims the history that actually gets sent to the model down to `maxChars`, per
// MODEL_HISTORY_CHARS above. This is NOT a rejection path — it never errors and the request
// it's applied to always returns 200. Rules, matching the invariants a client can rely on:
//   - the newest (last) message is always kept, even alone it exceeds `maxChars` — a single
//     long honest question must still reach the model, not be trimmed away to nothing;
//   - older messages are added back, oldest-dropped-first, only while they still fit;
//   - the result is always a contiguous suffix of `msgs` — nothing is ever dropped from the
//     middle.
// By the time this function runs, `bodySchema`'s `.refine()` has already guaranteed no
// single message exceeds MODEL_HISTORY_CHARS on its own (a request violating that is
// rejected with 400 before this ever executes) — so "even alone it exceeds `maxChars`"
// above no longer happens for the newest message in practice. The invariant is still
// enforced here defensively, independent of that upstream guarantee.
// Persistence is unaffected by this: callers must derive what they save from the ORIGINAL,
// untrimmed `body.messages`, not from this function's return value.
function trimHistoryForModel(
  msgs: readonly z.infer<typeof messageSchema>[],
  maxChars: number,
): z.infer<typeof messageSchema>[] {
  if (msgs.length === 0) return [];
  let total = JSON.stringify(msgs[msgs.length - 1]).length;
  let startIndex = msgs.length - 1;
  for (let i = msgs.length - 2; i >= 0; i--) {
    const size = JSON.stringify(msgs[i]).length;
    if (total + size > maxChars) break;
    total += size;
    startIndex = i;
  }
  // The size-based slice above stops purely on byte budget, so whether the resulting suffix
  // happens to START with a 'user' or an 'assistant' message depends only on message sizes —
  // realistic conversations (long visitor questions, short replies, per the system prompt)
  // regularly land on 'assistant'. The Anthropic Messages API requires the FIRST message in
  // a request to be role 'user', so a suffix starting on 'assistant' would be rejected by
  // the provider. Advance forward (never re-including anything already dropped, so the
  // result stays a contiguous suffix) until the first kept message is a user turn. The loop
  // bound is `msgs.length - 1`, so this can never advance past the newest message — the
  // invariant that the newest turn is always kept, even if it is itself an assistant message
  // (shouldn't happen from this client, but stay safe), holds regardless of role.
  while (startIndex < msgs.length - 1 && msgs[startIndex].role !== 'user') {
    startIndex++;
  }
  return msgs.slice(startIndex);
}

const bodySchema = z
  .object({
    messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
    conversationId: z.uuid(),
  })
  .refine(
    (body) => {
      const { totalChars, hasInvalidChars, maxMessageChars } = inspectMessages(body.messages);
      // A single message over MODEL_HISTORY_CHARS is rejected here — the same 400 path as
      // the other two checks — rather than silently truncated. See the comment block above
      // MAX_MESSAGES/HISTORY_ABUSE_MAX_CHARS/MODEL_HISTORY_CHARS for why.
      return totalChars <= HISTORY_ABUSE_MAX_CHARS && !hasInvalidChars && maxMessageChars <= MODEL_HISTORY_CHARS;
    },
    {
      message:
        'history exceeds the character budget, a single message exceeds the model history budget, or contains invalid characters',
    },
  );

// Sized against this branch's own worst-case per-request cost, not picked arbitrarily. A
// single request can run up to stepCountIs(5) model steps over up to MODEL_HISTORY_CHARS
// (24,000 chars, ~6,000 tokens) of history each step, priced at CHAT_MODEL's $3/M-in,
// $15/M-out (src/ai/pricing.ts) — roughly $0.1425 in the worst case. A looser 20 requests /
// 10 minutes window would permit ~2,880 requests/day from a single identity, or up to ~$2.85
// per 10-minute window: enough for one compliant visitor to exhaust a $40/mo tenant budget
// in a few hours, taking the whole demo dark for everyone else for the rest of the month
// even though the budget gate (fail-closed) does its job. The plan's $10-50/mo target
// implies roughly 300 requests/month total; 20/hour/identity is generous headroom for a real
// conversation while keeping one visitor's worst case to about $2.85/hour instead of
// $2.85/10-minutes. This does not change the budget-gate logic itself — checkBudget is still
// the actual backstop — it just makes the failure mode less severe.
// Exported (like the constants above) so tests can assert against the actual value instead
// of duplicating a magic number that could silently drift out of sync with this file.
export const CHAT_LIMIT = { limit: 20, windowSeconds: 3600 };

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

// Conversation ownership must rest on a value the caller cannot choose. A cookie the server
// mints and marks httpOnly is that value — unlike a request header, the visitor's own JS
// can't read or set it, and unlike an IP-derived key, an attacker can't spoof it onto
// themselves. A first-time visitor (no cookie, or a cookie that isn't a UUID we could have
// minted) gets a freshly minted one; everyone else keeps theirs.
function resolveVisitorId(req: Request): { visitorId: string; mintedCookieHeader?: string } {
  const existing = parseCookie(req, VISITOR_COOKIE_NAME);
  if (existing && z.uuid().safeParse(existing).success) {
    return { visitorId: existing };
  }
  const visitorId = crypto.randomUUID();
  return { visitorId, mintedCookieHeader: serializeVisitorCookie(visitorId) };
}

// Rate-limit identity is best-effort and separate from conversation ownership — it only
// needs to make abuse *expensive* to spread across identities, not prove who someone is.
// Trust assumption: `x-real-ip` and `x-vercel-forwarded-for` are set by the platform itself
// (Vercel), not forwarded verbatim from the client, so they're not attacker-controlled the
// way a bare `x-forwarded-for` is. `x-forwarded-for` is a comma-separated hop chain where
// the LEFTMOST entry is whatever the client claimed and the RIGHTMOST entry is the hop
// nearest us — we take the rightmost as the least-spoofable guess.
//
// When none of those platform headers are present, `visitorId` is only a trustworthy,
// STABLE identity if it came from a cookie the caller actually sent back —
// `hasStableIdentity` is false exactly when resolveVisitorId had to mint a fresh UUID for
// this single request (no valid existing cookie). Keying the limiter on a freshly-minted,
// per-request UUID would let any caller that simply ignores Set-Cookie (a bare curl loop, no
// cookie jar) get an unbounded number of one-shot buckets — each one permanently inserting
// its own `rate_limits` AND `conversations` row — which is a rate limiter in name only. So
// unidentifiable, header-less, cookie-less traffic is folded into one shared, conservative
// bucket instead; only a caller that keeps and returns its visitor cookie earns its own
// per-visitor bucket.
const ANONYMOUS_RATE_LIMIT_KEY = 'anon';

function resolveRateLimitIdentity(req: Request, visitorId: string, hasStableIdentity: boolean): string {
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  const vercelForwardedFor = req.headers.get('x-vercel-forwarded-for');
  if (vercelForwardedFor) return vercelForwardedFor.trim();

  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const hops = forwardedFor.split(',').map((hop) => hop.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  return hasStableIdentity ? visitorId : ANONYMOUS_RATE_LIMIT_KEY;
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

  // Everything below has consumed a rate-limit slot and, once ensureConversation runs, can
  // write rows — an unexpected failure here must never leak a stack trace or raw SQL to the
  // client. Validation itself (the parse above) is intentionally outside this try/catch so a
  // 400 for a malformed body stays a 400, not a 500.
  try {
    const church = await getChurchBySlug(deps.db, DEMO_CHURCH_SLUG);
    if (!church) return jsonResponse({ code: 'not_seeded' }, { status: 500 });

    // Scope the rate-limit key by tenant: `rate_limits` is a tenant-agnostic table keyed by
    // an opaque string, so the tenant must live in the key itself — otherwise visitors of
    // different churches would share one counter. `mintedCookieHeader` is set exactly when
    // the caller had no valid existing visitor cookie (see resolveVisitorId), so its absence
    // is what makes visitorId a stable, caller-honoured identity rather than a fresh
    // one-off UUID.
    const rateLimitId = resolveRateLimitIdentity(req, visitorId, !mintedCookieHeader);
    const rate = await checkRateLimit(deps.db, `chat:${church.id}:${rateLimitId}`, CHAT_LIMIT);
    if (!rate.allowed) return jsonResponse({ code: 'rate_limited' }, { status: 429 });

    const budget = await checkBudget(deps.db, church.id, deps.globalCapUsd);
    if (!budget.allowed) return jsonResponse({ code: 'budget_exhausted', reason: budget.reason }, { status: 402 });

    await ensureConversation(deps.db, { id: body.conversationId, churchId: church.id, visitorKey: visitorId });

    // ensureConversation uses onConflictDoNothing, so a client-supplied conversationId that
    // already belongs to someone else silently no-ops the insert instead of erroring. Load
    // the row as it actually exists and verify it belongs to this church AND this
    // cookie-identified visitor before letting the request read or append to it.
    const conversation = await getConversation(deps.db, body.conversationId);
    if (!conversation || conversation.churchId !== church.id || conversation.visitorKey !== visitorId) {
      return jsonResponse({ code: 'conversation_forbidden' }, { status: 403 });
    }

    // Persistence always uses the FULL, untrimmed history the client sent — trimming below
    // only affects what the model sees, never what gets saved. The newest message is the
    // same element either way (trimHistoryForModel always keeps it), so this is just reading
    // it from the untrimmed array directly rather than depending on the trim step at all.
    const last = body.messages[body.messages.length - 1];
    if (last?.role === 'user') {
      // The client (useChat) assigns a stable id to a message once and resends the same
      // history — unchanged — on a retry (the "try again" button calls regenerate(), which
      // resends the whole history including this exact message). Without something keying
      // off that id, every retry of the same turn inserts a second, duplicate `messages` row
      // for a question the visitor only asked once. Passing the client's id through as
      // `clientMessageId` (scoped to this conversation — see the unique index on
      // (conversation_id, client_message_id) in src/db/schema.ts) and letting saveMessage's
      // onConflictDoNothing skip the repeat makes the write idempotent per (conversation,
      // client message) instead of per HTTP call.
      await saveMessage(deps.db, {
        churchId: church.id,
        conversationId: body.conversationId,
        role: 'user',
        parts: last.parts,
        clientMessageId: last.id,
      });
    }

    // Trim the history handed to the model to MODEL_HISTORY_CHARS. Silent — no error, no
    // status change — see the constant comments above for why.
    const uiMessages = trimHistoryForModel(body.messages, MODEL_HISTORY_CHARS) as unknown as UIMessage[];

    // This is the channel-to-agent handoff: build the transport-agnostic envelope
    // (IncomingChat) once resolved from the HTTP request, then hand it to the secretary
    // exactly as a WhatsApp adapter would hand its own resolved envelope. Everything above
    // this point (cookies, headers, JSON body shape) is web-specific and stops here.
    const incoming: IncomingChat = {
      churchId: church.id,
      conversationId: body.conversationId,
      visitorKey: visitorId,
      uiMessages,
    };

    // convertToModelMessages is async in ai@7.0.68, so runSecretary returns a Promise.
    const result = await runSecretary(deps, { ...incoming, churchName: church.name });

    const streamHeaders = new Headers();
    if (mintedCookieHeader) streamHeaders.append('Set-Cookie', mintedCookieHeader);

    return result.toUIMessageStreamResponse({
      headers: streamHeaders,
      // `onFinish` is deprecated in ai@7.0.68 in favor of `onEnd` (identical signature,
      // including `responseMessage`) — using the non-deprecated name here.
      onEnd: async ({ responseMessage }) => {
        // onEnd still fires when the model call fails or is aborted before producing any
        // content — `responseMessage.parts` is `[]` in that case. Persisting that produces a
        // permanent, empty assistant row for every failed/retried turn, with no informational
        // value; Plan 3's staff inbox will read `messages` back and have to special-case it
        // forever. There is nothing worth saving, so skip the write entirely.
        if (responseMessage.parts.length === 0) return;
        await saveMessage(deps.db, {
          churchId: church.id,
          conversationId: body.conversationId,
          role: 'assistant',
          parts: responseMessage.parts,
        });
      },
      // Without this, a model/gateway failure produces no server-side log line at all — the
      // client correctly gets a masked generic message (unchanged: same default text the SDK
      // would use anyway), but the operator has no way to know it happened. Log the real
      // error server-side; the string returned here is what reaches the client, so it must
      // stay exactly as generic as the SDK's own default.
      onError: (error) => {
        console.error('handleChatRequest: model/stream failure', {
          conversationId: body.conversationId,
          churchId: church.id,
          error,
        });
        return 'An error occurred.';
      },
    });
  } catch (err) {
    console.error('handleChatRequest: unexpected failure', { conversationId: body.conversationId, error: err });
    return jsonResponse({ code: 'internal_error' }, { status: 500 });
  }
}

export type ChatHistoryDeps = { db: Db };

export type ChatHistoryResponseBody = {
  conversationId: string | null;
  messages: { id: string; role: string; parts: unknown }[];
};

const EMPTY_HISTORY: ChatHistoryResponseBody = { conversationId: null, messages: [] };

// Authorises a returning visitor to resume their OWN conversation, and nobody else's — using
// the exact same identity source `handleChatRequest` already trusts for ownership: the signed,
// httpOnly `ccb_visitor` cookie. This is deliberately a read-only lookup: unlike
// `handleChatRequest`, it never mints a fresh visitor cookie (a bare history check from a
// visitor who has never chatted yet has no identity worth minting one for — the POST path mints
// it the moment there's an actual first message to attach it to) and it never writes a
// `conversations` row.
//
// Every path that can't produce a real answer — no cookie, a cookie that isn't shaped like one
// this server would have minted, no church seeded, or no conversation found for this visitor —
// returns the exact same `EMPTY_HISTORY` shape. That's the load-bearing property: an attacker
// probing with a missing or garbage cookie learns nothing that distinguishes "you have no
// conversation" from "the server had a hiccup," and never receives another visitor's data.
export async function handleChatHistoryRequest(deps: ChatHistoryDeps, req: Request): Promise<Response> {
  const visitorId = parseCookie(req, VISITOR_COOKIE_NAME);
  if (!visitorId || !z.uuid().safeParse(visitorId).success) {
    return Response.json(EMPTY_HISTORY);
  }

  try {
    const church = await getChurchBySlug(deps.db, DEMO_CHURCH_SLUG);
    if (!church) return Response.json(EMPTY_HISTORY);

    const conversation = await getConversationByVisitor(deps.db, church.id, visitorId);
    if (!conversation) return Response.json(EMPTY_HISTORY);

    const history = await listMessages(deps.db, conversation.id);
    return Response.json({
      conversationId: conversation.id,
      messages: history.map((m) => ({ id: m.id, role: m.role, parts: m.parts })),
    } satisfies ChatHistoryResponseBody);
  } catch (error) {
    // Same posture as handleChatRequest's catch-all: log the real error server-side, never
    // leak a stack trace or raw SQL to the client. Unlike the POST path, there is no
    // side-effecting request to fail loudly on — degrading to "no history" instead of a 500
    // just means a returning visitor starts a fresh-looking thread instead of seeing an error,
    // which is the better failure mode for a read-only convenience lookup.
    console.error('handleChatHistoryRequest: unexpected failure', { error });
    return Response.json(EMPTY_HISTORY);
  }
}
