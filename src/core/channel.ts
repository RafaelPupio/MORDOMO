import type { UIMessage } from 'ai';

// Channel contract: every chat surface converts its transport into this shape and
// hands it to the secretary agent. The web adapter (src/channels/web.ts) streams the
// reply back over HTTP; a future WhatsApp adapter would buffer the full reply and
// call its Graph-API `deliver` instead. Core agent code never imports transport code.
export type IncomingChat = {
  churchId: string;
  conversationId: string;
  visitorKey: string;
  uiMessages: UIMessage[];
};

export interface ChannelAdapter {
  readonly name: 'web' | 'whatsapp';
  readonly supportsStreaming: boolean;
}
