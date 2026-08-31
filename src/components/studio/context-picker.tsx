'use client';

import { OrganizationSwitcher } from '@clerk/nextjs';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { enterSecretaryContext } from '@/app/[locale]/onboarding/actions';
import type {
  BetaLocale,
  SecretaryContextKind,
} from '@/core/secretary-profile';
import type { BetaMessages } from '@/i18n/beta-messages';

type ContextPickerProps = {
  locale: BetaLocale;
  messages: BetaMessages;
};

type OnboardingCopy = {
  onboarding: string;
  organizationTag: string;
  personalTag: string;
  eyebrow: string;
  title: string;
  intro: string;
  betaBoundary: string;
  organizationDescription: string;
  personalDescription: string;
  organizationPicker: string;
  organizationHelp: string;
  personalHelp: string;
  continueLabel: string;
  pendingLabel: string;
  organizationRequired: string;
  forbidden: string;
  invalid: string;
  languageLabel: string;
};

const ONBOARDING_COPY: Record<BetaLocale, OnboardingCopy> = {
  en: {
    onboarding: 'Onboarding',
    organizationTag: 'ORG',
    personalTag: 'LOCAL',
    eyebrow: 'Invite-only foundation',
    title: 'Set the desk before the first reply.',
    intro: 'Choose where this secretary will work. MORDOMO verifies the signed-in context again before opening Studio.',
    betaBoundary: 'This foundation stores only typed, non-sensitive Organization settings. Private notes and reminders are not saved.',
    organizationDescription: 'Configure a secretary for an organization you were invited to manage.',
    personalDescription: 'Explore a browser-local Personal Secretary profile without saving or publishing it.',
    organizationPicker: 'Active Clerk organization',
    organizationHelp: 'Select an existing invited organization. New organizations cannot be created here.',
    personalHelp: 'This preview stays in this browser tab and is not a production security boundary.',
    continueLabel: 'Continue to Studio',
    pendingLabel: 'Checking context…',
    organizationRequired: 'Select an invited organization in Clerk first.',
    forbidden: 'Sign in with an invited account to continue.',
    invalid: 'Choose Organization or Personal Secretary.',
    languageLabel: 'Language',
  },
  pt: {
    onboarding: 'Integração',
    organizationTag: 'ORG',
    personalTag: 'LOCAL',
    eyebrow: 'Fundação somente por convite',
    title: 'Prepare a mesa antes da primeira resposta.',
    intro: 'Escolha onde esta secretária trabalhará. O MORDOMO verifica novamente o contexto autenticado antes de abrir o Studio.',
    betaBoundary: 'Esta fundação salva apenas configurações tipadas e não sensíveis da Organização. Notas privadas e lembretes não são salvos.',
    organizationDescription: 'Configure uma secretária para uma organização que você foi convidado a administrar.',
    personalDescription: 'Explore um perfil de Secretária Pessoal local no navegador, sem salvar ou publicar.',
    organizationPicker: 'Organização ativa no Clerk',
    organizationHelp: 'Selecione uma organização existente por convite. Novas organizações não podem ser criadas aqui.',
    personalHelp: 'Esta prévia fica nesta aba do navegador e não representa uma barreira de segurança de produção.',
    continueLabel: 'Continuar para o Studio',
    pendingLabel: 'Verificando contexto…',
    organizationRequired: 'Primeiro selecione no Clerk uma organização para a qual você foi convidado.',
    forbidden: 'Entre com uma conta convidada para continuar.',
    invalid: 'Escolha Organização ou Secretária Pessoal.',
    languageLabel: 'Idioma',
  },
};

export function ContextPicker({ locale, messages }: ContextPickerProps) {
  const [selected, setSelected] = useState<SecretaryContextKind>('organization');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const copy = ONBOARDING_COPY[locale];

  function continueToStudio() {
    setError(undefined);
    startTransition(async () => {
      const state = await enterSecretaryContext(locale, selected);
      if (state.error) setError(copy[state.error]);
    });
  }

  return (
    <main className="min-h-screen bg-[#f4f7f5] text-[#102421]">
      <header className="border-b border-[#102421]/15 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center bg-[#102421] font-mono text-sm font-bold text-[#6ee7b7]" aria-hidden="true">M</span>
            <div>
              <p className="font-mono text-[0.66rem] uppercase tracking-[0.22em] text-[#102421]/60">MORDOMO</p>
              <p className="text-sm font-semibold">{copy.onboarding}</p>
            </div>
          </div>
          <nav aria-label={copy.languageLabel} className="flex items-center gap-1 font-mono text-xs">
            <Link href="/en/onboarding" aria-current={locale === 'en' ? 'page' : undefined} className={`px-2 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102421] ${locale === 'en' ? 'bg-[#6ee7b7] font-bold' : ''}`}>EN</Link>
            <span aria-hidden="true" className="text-[#102421]/35">/</span>
            <Link href="/pt/onboarding" aria-current={locale === 'pt' ? 'page' : undefined} className={`px-2 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102421] ${locale === 'pt' ? 'bg-[#6ee7b7] font-bold' : ''}`}>PT</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[#167052]">{copy.eyebrow}</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">{copy.title}</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-[#102421]/70">{copy.intro}</p>

        <aside className="mt-8 border-l-4 border-[#d9a62e] bg-[#fef3c7] px-5 py-4 text-sm leading-6" aria-label={copy.eyebrow}>
          {copy.betaBoundary}
        </aside>

        <div className="mt-10 grid gap-4 md:grid-cols-2" aria-label={messages.context.title} role="group">
          <button
            aria-pressed={selected === 'organization'}
            className={`min-h-40 border p-6 text-left transition-colors focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#167052] ${selected === 'organization' ? 'border-[#102421] bg-white shadow-[5px_5px_0_#6ee7b7]' : 'border-[#102421]/20 bg-white/60 hover:border-[#102421]/50'}`}
            onClick={() => setSelected('organization')}
            type="button"
          >
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-[#167052]">{copy.organizationTag}</span>
            <span className="mt-4 block text-xl font-semibold">{messages.context.organization}</span>
            <span className="mt-2 block text-sm leading-6 text-[#102421]/65">{copy.organizationDescription}</span>
          </button>
          <button
            aria-pressed={selected === 'personal'}
            className={`min-h-40 border p-6 text-left transition-colors focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#167052] ${selected === 'personal' ? 'border-[#102421] bg-white shadow-[5px_5px_0_#6ee7b7]' : 'border-[#102421]/20 bg-white/60 hover:border-[#102421]/50'}`}
            onClick={() => setSelected('personal')}
            type="button"
          >
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-[#167052]">{copy.personalTag}</span>
            <span className="mt-4 block text-xl font-semibold">{messages.context.personal}</span>
            <span className="mt-2 block text-sm leading-6 text-[#102421]/65">{copy.personalDescription}</span>
          </button>
        </div>

        <div className="mt-6 border border-[#102421]/20 bg-white p-6">
          {selected === 'organization' ? (
            <div>
              <p className="text-sm font-semibold">{copy.organizationPicker}</p>
              <p className="mt-1 text-sm leading-6 text-[#102421]/65">{copy.organizationHelp}</p>
              <div className="mt-4 inline-flex min-h-10 items-center border border-[#102421]/20 px-3">
                <OrganizationSwitcher hidePersonal={true} />
              </div>
            </div>
          ) : (
            <p className="text-sm leading-6 text-[#102421]/70">{copy.personalHelp}</p>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              className="min-h-11 bg-[#102421] px-5 py-3 text-sm font-semibold text-white hover:bg-[#193a34] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#6ee7b7] disabled:cursor-wait disabled:opacity-65"
              disabled={pending}
              onClick={continueToStudio}
              type="button"
            >
              {pending ? copy.pendingLabel : copy.continueLabel}
            </button>
            <p aria-live="polite" className="text-sm font-medium text-[#8a4b0f]">{error}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
