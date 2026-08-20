'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useMemo, useState } from 'react';

type SourceOut = { documentTitle: string; excerpt: string };

function SourceChips({ sources }: { sources: SourceOut[] }) {
  if (!sources.length) return null;
  const titles = [...new Set(sources.map((s) => s.documentTitle))];
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {titles.map((t) => (
        <span
          key={t}
          title={sources.find((s) => s.documentTitle === t)?.excerpt}
          className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
        >
          📄 {t}
        </span>
      ))}
    </div>
  );
}

// The server's error responses are small JSON bodies — { code: '...' } — and the AI SDK's
// HttpChatTransport surfaces a non-2xx response as `new Error(await response.text())`, so
// `error.message` here IS that raw JSON string. Parsing it back out lets the UI tell a
// visitor "the demo ran out of budget for the month" (402) apart from "you're sending
// messages too fast" (429) apart from everything else, instead of one generic message for
// every failure. If the body isn't JSON (a network failure, an aborted fetch, a proxy error
// page), fall through to the generic case rather than throwing.
type ErrorKind = 'budget' | 'rate_limit' | 'other';

function classifyError(error: Error): ErrorKind {
  try {
    const parsed = JSON.parse(error.message) as { code?: unknown };
    if (parsed.code === 'budget_exhausted') return 'budget';
    if (parsed.code === 'rate_limited') return 'rate_limit';
  } catch {
    // Not a JSON error body — treat as a generic failure.
  }
  return 'other';
}

function ErrorNotice({ error }: { error: Error }) {
  const kind = classifyError(error);
  const copy: Record<ErrorKind, string> = {
    budget:
      'O demo está temporariamente indisponível (limite de uso do mês atingido). Tente novamente mais tarde. · The demo has hit its monthly usage limit — please try again later.',
    rate_limit:
      'Você enviou mensagens rápido demais. Aguarde um pouco antes de tentar de novo. · You are sending messages too quickly — please wait a moment and try again.',
    other:
      'Algo deu errado ao enviar sua mensagem. Tente novamente em instantes. · Something went wrong sending your message. Please try again shortly.',
  };
  return (
    <p className="text-sm text-amber-700" role="alert">
      {copy[kind]}
    </p>
  );
}

export default function Chat() {
  const conversationId = useMemo(() => crypto.randomUUID(), []);
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { conversationId } }),
    [conversationId],
  );
  const { messages, sendMessage, status, error } = useChat({ transport });
  const [input, setInput] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status !== 'ready') return;
    sendMessage({ text: input });
    setInput('');
  };

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col p-4">
      <header className="border-b pb-3">
        <h1 className="text-lg font-semibold">Secretária Virtual — Igreja da Colina</h1>
        <p className="text-xs text-neutral-500">
          Igreja fictícia — demonstração · Fictional church — demo. Write in any language.
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="text-sm text-neutral-500">
            Pergunte sobre horários de culto, eventos, ministérios — ou peça oração. 🙏
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-[85%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-900'}`}
            >
              {m.parts.map((part, i) => {
                if (part.type === 'text') return <span key={i}>{part.text}</span>;
                if (part.type === 'tool-searchKnowledge' && part.state === 'output-available') {
                  const out = part.output as { sources: SourceOut[] };
                  return <SourceChips key={i} sources={out.sources} />;
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {status === 'submitted' && (
          <p className="text-sm text-neutral-400" aria-live="polite">
            …
          </p>
        )}
        {error && <ErrorNotice error={error} />}
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t pt-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua mensagem…"
          disabled={status !== 'ready'}
          aria-label="Mensagem"
          className="flex-1 rounded-xl border px-4 py-2 text-sm outline-none focus:border-neutral-400 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status !== 'ready'}
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
