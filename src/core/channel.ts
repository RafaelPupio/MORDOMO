import type { UIMessage } from 'ai';

// The channel-agnostic envelope every chat surface converts its transport into before
// calling the secretary agent (src/agent/secretary.ts: SecretaryInput extends this with
// only the one piece of context no transport can supply — the church's display name).
// src/channels/web.ts resolves cookies, headers and the HTTP body, then builds one of
// these and hands it to the agent; a future WhatsApp channel would resolve a webhook
// payload instead, build the same shape, and hand it to the same agent. Either way, the
// agent, core retrieval/chunking code, and the db repos never import anything transport-
// specific — they only ever see this type.
export type IncomingChat = {
  organizationId: string;
  conversationId: string;
  visitorKey: string;
  uiMessages: UIMessage[];
};

// What a WhatsApp channel WOULD need to add, and wouldn't:
// - Would add: a webhook handler that authenticates the Meta request, resolves the
//   sender's phone number to a visitorKey, and turns the payload into an IncomingChat;
//   delivery via the Graph API instead of an HTTP stream, since WhatsApp has no
//   token-by-token streaming.
// - Would NOT change: runSecretary, secretaryTools, retrieval, chunking, or any db repo —
//   none of them know a channel exists.
//
// There is deliberately no ChannelAdapter/capability-flag interface here. With exactly one
// channel shipped, a registry of adapters would have no second implementation to
// distinguish itself from — it would be exactly the kind of unused surface this file used
// to carry. That abstraction is worth introducing when a second channel is actually being
// built, not before.
