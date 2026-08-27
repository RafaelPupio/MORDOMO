import Link from 'next/link';
import { GITHUB_REPOSITORY_URL, PRODUCT_NAME } from '@/brand';
import { getHomeMessages, type CapabilityTone } from '@/i18n/home-messages';
import { localizedPath, type Locale } from '@/i18n/locales';

const toneClass: Record<CapabilityTone, string> = {
  mint: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  sky: 'border-sky-200 bg-sky-50 text-sky-950',
  amber: 'border-amber-200 bg-amber-50 text-amber-950',
};

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function FlowNode({ eyebrow, title, copy, tone }: { eyebrow: string; title: string; copy: string; tone: CapabilityTone }) {
  const border = tone === 'mint' ? 'border-emerald-400/40' : tone === 'sky' ? 'border-sky-400/40' : 'border-amber-400/40';
  const dot = tone === 'mint' ? 'bg-emerald-300' : tone === 'sky' ? 'bg-sky-300' : 'bg-amber-300';

  return (
    <div className={`rounded-2xl border ${border} bg-slate-950/70 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.15)]`}>
      <p className="flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] text-slate-400 uppercase"><span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{eyebrow}</p>
      <h3 className="mt-2 text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-300">{copy}</p>
    </div>
  );
}

export function MordomoHome({ locale }: { locale: Locale }) {
  const messages = getHomeMessages(locale);
  const designSpecUrl = `${GITHUB_REPOSITORY_URL}/blob/main/docs/superpowers/specs/2026-08-25-ai-secretary-saas-beta-design.md`;
  const plansUrl = `${GITHUB_REPOSITORY_URL}/tree/main/docs/superpowers/plans`;

  return (
    <main lang={locale} className="min-h-dvh overflow-hidden bg-[#f4f7f5] text-[#102421]">
      <section className="relative isolate overflow-hidden bg-[#102421] px-5 pt-5 pb-16 text-white sm:px-8 lg:px-12 lg:pb-24">
        <div className="absolute top-0 right-[-12rem] h-[32rem] w-[32rem] rounded-full bg-emerald-400/15 blur-3xl" />
        <div className="absolute bottom-[-16rem] left-[22%] h-[34rem] w-[34rem] rounded-full bg-sky-400/10 blur-3xl" />
        <div className="relative mx-auto max-w-6xl">
          <nav className="flex flex-wrap items-center justify-between gap-4" aria-label="Primary navigation">
            <Link href={localizedPath(locale)} className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white"><span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-300 font-serif text-lg font-semibold text-[#102421]">M</span>{PRODUCT_NAME}</Link>
            <div className="flex items-center gap-4">
              <div className="flex flex-wrap justify-end gap-x-2 gap-y-1 text-xs" aria-label={messages.languageLabel}>
                {messages.languageOptions.map((option) => <Link key={option.locale} href={localizedPath(option.locale)} aria-current={option.locale === locale ? 'page' : undefined} className={`rounded-md px-1.5 py-1 underline-offset-4 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200 ${option.locale === locale ? 'bg-white/10 font-semibold text-white' : 'text-slate-400 hover:text-white'}`}>{option.label}</Link>)}
              </div>
              <a href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer" className="hidden text-sm text-slate-300 underline decoration-slate-600 underline-offset-4 hover:text-white sm:inline">{messages.codeLink} <Arrow /></a>
            </div>
          </nav>

          <div className="grid gap-12 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-24">
            <div>
              <p className="font-mono text-xs font-semibold tracking-[0.18em] text-emerald-300 uppercase">{messages.hero.eyebrow}</p>
              <h1 className="mt-5 max-w-3xl text-5xl font-semibold tracking-[-0.055em] text-balance sm:text-6xl lg:text-7xl">{messages.hero.title}</h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">{messages.hero.intro}</p>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-400">{messages.hero.demoNote}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={messages.hero.primaryCta.href} className="rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-[#102421] shadow-[0_8px_24px_rgba(110,231,183,0.18)] transition hover:bg-emerald-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-100">{messages.hero.primaryCta.label} <Arrow /></Link>
                <Link href={messages.hero.secondaryCta.href} className="rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-100">{messages.hero.secondaryCta.label}</Link>
              </div>
              <dl className="mt-10 grid max-w-xl grid-cols-3 gap-5 border-t border-white/10 pt-5">{messages.facts.map((fact) => <div key={fact.label}><dt className="font-mono text-[10px] tracking-[0.16em] text-slate-400 uppercase">{fact.label}</dt><dd className="mt-1 text-sm font-medium">{fact.value}</dd></div>)}</dl>
            </div>

            <div className="relative rounded-[2rem] border border-white/10 bg-white/[0.045] p-4 shadow-2xl backdrop-blur sm:p-6">
              <div className="absolute top-4 right-5 max-w-48 text-right font-mono text-[10px] tracking-[0.16em] text-slate-500 uppercase">{messages.diagram.eyebrow}</div>
              <div className="grid gap-3 pt-8">
                <FlowNode {...messages.diagram.visitor} tone="mint" />
                <div className="mx-5 h-5 border-l border-dashed border-slate-600" aria-hidden="true" />
                <div className="grid gap-3 sm:grid-cols-2"><FlowNode {...messages.diagram.documents} tone="sky" /><FlowNode {...messages.diagram.reports} tone="amber" /></div>
              </div>
              <p className="mt-5 border-t border-white/10 pt-4 text-sm leading-6 text-slate-400">{messages.diagram.rationale}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end"><div><p className="font-mono text-xs font-semibold tracking-[0.16em] text-emerald-800 uppercase">{messages.capabilitySection.eyebrow}</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#102421] sm:text-4xl">{messages.capabilitySection.title}</h2></div><p className="max-w-2xl text-base leading-7 text-[#53655f]">{messages.capabilitySection.copy}</p></div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{messages.capabilities.map((capability) => <article key={capability.name} className={`rounded-2xl border p-5 ${toneClass[capability.tone]}`}><p className="font-mono text-[10px] font-semibold tracking-[0.15em] uppercase opacity-60">{capability.home}</p><h3 className="mt-2 text-lg font-semibold tracking-tight">{capability.name}</h3><p className="mt-2 text-sm leading-6 opacity-75">{capability.detail}</p></article>)}</div>
      </section>

      <section className="border-y border-[#d7e1dc] bg-white px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2"><div><p className="font-mono text-xs font-semibold tracking-[0.16em] text-emerald-800 uppercase">{messages.proof.eyebrow}</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{messages.proof.title}</h2><p className="mt-4 max-w-xl leading-7 text-[#53655f]">{messages.proof.copy}</p></div><div className="rounded-2xl border border-[#d7e1dc] bg-[#f4f7f5] p-6"><p className="text-sm font-medium text-[#102421]">{messages.proof.question}</p><p className="mt-4 rounded-xl bg-white p-4 text-sm leading-6 text-[#53655f] shadow-sm">{messages.proof.answer}</p><div className="mt-3 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">📄 {messages.proof.citation}</div></div></div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
        <div className="rounded-[2rem] bg-[#dff5ea] p-7 sm:p-10"><div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center"><div><p className="font-mono text-xs font-semibold tracking-[0.16em] text-emerald-800 uppercase">{messages.closing.eyebrow}</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#102421]">{messages.closing.title}</h2><p className="mt-3 max-w-2xl leading-7 text-[#3d5b50]">{messages.closing.copy}</p></div><div className="flex flex-wrap gap-3 lg:justify-end"><a href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer" className="rounded-xl bg-[#102421] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#203a34]">{messages.closing.code} <Arrow /></a><a href={designSpecUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-[#86b9a4] px-5 py-3 text-sm font-semibold text-[#102421] transition hover:bg-white/50">{messages.closing.spec} <Arrow /></a><a href={plansUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-[#86b9a4] px-5 py-3 text-sm font-semibold text-[#102421] transition hover:bg-white/50">{messages.closing.plans} <Arrow /></a></div></div></div>
      </section>

      <footer className="border-t border-[#d7e1dc] px-5 py-7 text-center text-xs text-[#6b7e76]">{messages.footer}</footer>
    </main>
  );
}

