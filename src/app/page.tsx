import Link from 'next/link';

type Capability = {
  name: string;
  home: string;
  detail: string;
  tone: 'mint' | 'sky' | 'amber';
};

const capabilities: Capability[] = [
  { name: 'AI chatbot', home: 'Visitor chat', detail: 'Streams bilingual replies in the web demo.', tone: 'mint' },
  { name: 'AI agent', home: 'Secretary', detail: 'Uses four bounded tools instead of improvising facts.', tone: 'mint' },
  { name: 'RAG', home: 'Knowledge search', detail: 'Answers are grounded in church documents with citations.', tone: 'mint' },
  { name: 'Knowledge base', home: 'pgvector corpus', detail: 'Tenant-scoped chunks, embeddings, and source provenance.', tone: 'mint' },
  { name: 'Document processing', home: 'Ingest', detail: 'Parses PDF and Markdown before a document is published.', tone: 'sky' },
  { name: 'Data extraction', home: 'Extractor', detail: 'Finds candidate calendar events in source material.', tone: 'sky' },
  { name: 'Multi-agent system', home: 'Verifier', detail: 'A second model audits every extracted event against the source.', tone: 'sky' },
  { name: 'Workflow automation', home: 'Pipeline + cron', detail: 'Ingest and weekly-report workflows have explicit stages.', tone: 'sky' },
  { name: 'AI reporting', home: 'Weekly digest', detail: 'Analyst finds patterns; writer turns findings into a staff report.', tone: 'amber' },
  { name: 'AI customer support', home: 'Staff inbox', detail: 'Grounded draft replies stay editable and human-approved.', tone: 'amber' },
];

const toneClass = {
  mint: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  sky: 'border-sky-200 bg-sky-50 text-sky-950',
  amber: 'border-amber-200 bg-amber-50 text-amber-950',
};

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function FlowNode({ eyebrow, title, copy, tone }: { eyebrow: string; title: string; copy: string; tone: 'mint' | 'sky' | 'amber' }) {
  const border = tone === 'mint' ? 'border-emerald-400/40' : tone === 'sky' ? 'border-sky-400/40' : 'border-amber-400/40';
  const dot = tone === 'mint' ? 'bg-emerald-300' : tone === 'sky' ? 'bg-sky-300' : 'bg-amber-300';
  return (
    <div className={`rounded-2xl border ${border} bg-slate-950/70 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.15)]`}>
      <p className="flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] text-slate-400 uppercase">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} /> {eyebrow}
      </p>
      <h3 className="mt-2 text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-300">{copy}</p>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-dvh overflow-hidden bg-[#f4f7f5] text-[#102421]">
      <section className="relative isolate overflow-hidden bg-[#102421] px-5 pt-5 pb-16 text-white sm:px-8 lg:px-12 lg:pb-24">
        <div className="absolute top-0 right-[-12rem] h-[32rem] w-[32rem] rounded-full bg-emerald-400/15 blur-3xl" />
        <div className="absolute bottom-[-16rem] left-[22%] h-[34rem] w-[34rem] rounded-full bg-sky-400/10 blur-3xl" />
        <div className="relative mx-auto max-w-6xl">
          <nav className="flex items-center justify-between gap-4" aria-label="Primary navigation">
            <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-300 text-lg text-[#102421]">✦</span>
              ChurchChatBox <span className="font-normal text-emerald-200">V2</span>
            </Link>
            <a href="https://github.com/RafaelPupio/ChurchChatBoxV2" target="_blank" rel="noreferrer" className="text-sm text-slate-300 underline decoration-slate-600 underline-offset-4 hover:text-white">
              View the code <Arrow />
            </a>
          </nav>

          <div className="grid gap-12 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-24">
            <div>
              <p className="font-mono text-xs font-semibold tracking-[0.18em] text-emerald-300 uppercase">AI systems portfolio project</p>
              <h1 className="mt-5 max-w-3xl text-5xl font-semibold tracking-[-0.055em] text-balance sm:text-6xl lg:text-7xl">A church secretary that shows its work.</h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">ChurchChatBox V2 is an AI-powered secretary for a fictional Brazilian church. It answers from its own documents, cites its sources, and gives staff the final word.</p>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-400">Igreja da Colina, every document, and every person in this demo are fictional. This is a portfolio build — not a live church service.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/chat" className="rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-[#102421] shadow-[0_8px_24px_rgba(110,231,183,0.18)] transition hover:bg-emerald-200">Try the visitor chat <Arrow /></Link>
                <Link href="/staff" className="rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/5">Open staff area <span className="font-normal text-slate-300">(password required)</span></Link>
              </div>
              <dl className="mt-10 grid max-w-xl grid-cols-3 gap-5 border-t border-white/10 pt-5">
                <div><dt className="font-mono text-[10px] tracking-[0.16em] text-slate-400 uppercase">Grounding</dt><dd className="mt-1 text-sm font-medium">Cited RAG</dd></div>
                <div><dt className="font-mono text-[10px] tracking-[0.16em] text-slate-400 uppercase">Guardrail</dt><dd className="mt-1 text-sm font-medium">Human approval</dd></div>
                <div><dt className="font-mono text-[10px] tracking-[0.16em] text-slate-400 uppercase">Status</dt><dd className="mt-1 text-sm font-medium text-amber-200">Built, not deployed</dd></div>
              </dl>
            </div>

            <div className="relative rounded-[2rem] border border-white/10 bg-white/[0.045] p-4 shadow-2xl backdrop-blur sm:p-6">
              <div className="absolute top-4 right-5 font-mono text-[10px] tracking-[0.16em] text-slate-500 uppercase">How it is wired</div>
              <div className="grid gap-3 pt-6">
                <FlowNode eyebrow="Hot path · one agent" title="Visitor asks a question" copy="Secretary agent → knowledge search / calendar / prayer / escalation → cited reply" tone="mint" />
                <div className="mx-5 h-5 border-l border-dashed border-slate-600" aria-hidden="true" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <FlowNode eyebrow="Async · two agents" title="Document ingest" copy="Parser → extractor → verifier → trusted events and knowledge." tone="sky" />
                  <FlowNode eyebrow="Weekly · two agents" title="Staff reporting" copy="Analyst → writer → a private, privacy-bounded digest." tone="amber" />
                </div>
              </div>
              <p className="mt-5 border-t border-white/10 pt-4 text-sm leading-6 text-slate-400">The architectural point: do not put orchestration in front of every visitor message. Use one agent where speed matters; use a second pass only where it materially improves trust.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
          <div>
            <p className="font-mono text-xs font-semibold tracking-[0.16em] text-emerald-800 uppercase">Capability map</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#102421] sm:text-4xl">Ten capabilities. Each has a real home.</h2>
          </div>
          <p className="max-w-2xl text-base leading-7 text-[#53655f]">This is not a feature wishlist. The system was built to demonstrate how the capabilities connect, with explicit tenant scoping, usage metering, reviewable workflows, and visible provenance.</p>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((capability) => (
            <article key={capability.name} className={`rounded-2xl border p-5 ${toneClass[capability.tone]}`}>
              <p className="font-mono text-[10px] font-semibold tracking-[0.15em] uppercase opacity-60">{capability.home}</p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight">{capability.name}</h3>
              <p className="mt-2 text-sm leading-6 opacity-75">{capability.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-[#d7e1dc] bg-white px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2">
          <div>
            <p className="font-mono text-xs font-semibold tracking-[0.16em] text-emerald-800 uppercase">What visitors see</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Answers with receipts.</h2>
            <p className="mt-4 max-w-xl leading-7 text-[#53655f]">The chat does not claim a service time or event date from memory. It retrieves church material first and gives the visitor document citations they can inspect.</p>
          </div>
          <div className="rounded-2xl border border-[#d7e1dc] bg-[#f4f7f5] p-6">
            <p className="text-sm font-medium text-[#102421]">“What time is the Sunday service?”</p>
            <p className="mt-4 rounded-xl bg-white p-4 text-sm leading-6 text-[#53655f] shadow-sm">The Sunday services are at 10:00 and 18:30. If you need help getting there, I can share the address too.</p>
            <div className="mt-3 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">📄 Horários e Contato — Igreja da Colina</div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
        <div className="rounded-[2rem] bg-[#dff5ea] p-7 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="font-mono text-xs font-semibold tracking-[0.16em] text-emerald-800 uppercase">Project status</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#102421]">All four product plans are built.</h2>
              <p className="mt-3 max-w-2xl leading-7 text-[#3d5b50]">The codebase has not been deployed yet. Production setup still needs a Neon database, real embeddings benchmarked against the seeded corpus, and Vercel environment configuration.</p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a href="https://github.com/RafaelPupio/ChurchChatBoxV2" target="_blank" rel="noreferrer" className="rounded-xl bg-[#102421] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#203a34]">Repository <Arrow /></a>
              <a href="https://github.com/RafaelPupio/ChurchChatBoxV2/blob/main/docs/superpowers/specs/2026-08-18-churchchatbox-v2-design.md" target="_blank" rel="noreferrer" className="rounded-xl border border-[#86b9a4] px-5 py-3 text-sm font-semibold text-[#102421] transition hover:bg-white/50">Design spec <Arrow /></a>
              <a href="https://github.com/RafaelPupio/ChurchChatBoxV2/tree/main/docs/superpowers/plans" target="_blank" rel="noreferrer" className="rounded-xl border border-[#86b9a4] px-5 py-3 text-sm font-semibold text-[#102421] transition hover:bg-white/50">Implementation plans <Arrow /></a>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#d7e1dc] px-5 py-7 text-center text-xs text-[#6b7e76]">Built as a portfolio project by Rafael Pupio Vieira · Fictional church, fictional data, real engineering decisions.</footer>
    </main>
  );
}
