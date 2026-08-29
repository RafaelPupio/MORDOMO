'use client';

import Link from 'next/link';
import { useActionState, useState, useTransition } from 'react';
import {
  publishStudioProfile,
  saveStudioDraft,
  type StudioActionState,
} from '@/app/[locale]/studio/actions';
import type { Capability, ReplyTone } from '@/core/organization-profile';
import {
  parseSecretaryProfile,
  type BetaLocale,
  type SecretaryContextKind,
  type SecretaryProfile,
  type SecretarySegment,
} from '@/core/secretary-profile';
import type { BetaMessages } from '@/i18n/beta-messages';
import { buildStudioPreview } from '@/studio/preview';
import { STUDIO_SCENARIOS } from '@/studio/scenarios';

type SecretaryStudioProps = {
  initialProfile: SecretaryProfile;
  kind: SecretaryContextKind;
  locale: BetaLocale;
  messages: BetaMessages;
  versionId?: string;
};

type StudioCopy = {
  studio: string;
  configure: string;
  testRail: string;
  context: string;
  betaBoundary: string;
  personalBoundary: string;
  organizationBoundary: string;
  segment: string;
  scenario: string;
  result: string;
  capability: string;
  citation: string;
  noCitation: string;
  escalationBoundary: string;
  savePending: string;
  publishPending: string;
  draftSaved: string;
  published: string;
  forbidden: string;
  invalid: string;
  notFound: string;
  personalNotSaved: string;
  noDraft: string;
  languageLabel: string;
  segments: Record<Exclude<SecretarySegment, 'personal'>, string>;
  tones: Record<ReplyTone, string>;
  capabilities: Record<Capability, string>;
};

const EMPTY_ACTION_STATE: StudioActionState = {};
const ORGANIZATION_SEGMENTS: Exclude<SecretarySegment, 'personal'>[] = [
  'church',
  'clinic',
  'restaurant',
  'real_estate',
  'general',
];
const REPLY_TONES: ReplyTone[] = ['warm', 'professional', 'concise'];
const CAPABILITIES: Capability[] = [
  'knowledge',
  'calendar',
  'confidential_request',
  'escalation',
];

const STUDIO_COPY: Record<BetaLocale, StudioCopy> = {
  en: {
    studio: 'Secretary Studio',
    configure: 'Configure',
    testRail: 'Deterministic test rail',
    context: 'Context',
    betaBoundary: 'Foundation boundary',
    personalBoundary: 'Personal is browser-local preview only. Save and publish stay disabled.',
    organizationBoundary: 'Organization drafts and publication are scoped again on the server to the active Clerk organization.',
    segment: 'Operating segment',
    scenario: 'Scenario',
    result: 'Result kind',
    capability: 'Required capability',
    citation: 'Fictional citation',
    noCitation: 'No citation: this scenario reaches the human escalation boundary.',
    escalationBoundary: 'This is a deterministic preview. It does not call AI, research the web, send messages, book events, or connect a calendar.',
    savePending: 'Saving draft…',
    publishPending: 'Publishing…',
    draftSaved: 'Draft saved.',
    published: 'Published.',
    forbidden: 'This account cannot change the active Organization profile.',
    invalid: 'Review the marked profile fields.',
    notFound: 'That profile version is not available in the active Organization.',
    personalNotSaved: 'Personal configuration remains browser-local and was not saved.',
    noDraft: 'Save a draft, then reload Studio before publishing that version.',
    languageLabel: 'Language',
    segments: { church: 'Church', clinic: 'Clinic', restaurant: 'Restaurant', real_estate: 'Real estate', general: 'General organization' },
    tones: { warm: 'Warm', professional: 'Professional', concise: 'Concise' },
    capabilities: { knowledge: 'Verified knowledge', calendar: 'Calendar-aware draft', confidential_request: 'Confidential intake', escalation: 'Human escalation' },
  },
  pt: {
    studio: 'Studio da Secretária',
    configure: 'Configurar',
    testRail: 'Trilho de teste determinístico',
    context: 'Contexto',
    betaBoundary: 'Limite da fundação',
    personalBoundary: 'Pessoal é somente uma prévia local no navegador. Salvar e publicar permanecem desativados.',
    organizationBoundary: 'Rascunhos e publicações da Organização são vinculados novamente no servidor à organização ativa no Clerk.',
    segment: 'Segmento de atuação',
    scenario: 'Cenário',
    result: 'Tipo de resultado',
    capability: 'Capacidade necessária',
    citation: 'Citação fictícia',
    noCitation: 'Sem citação: este cenário chega ao limite de encaminhamento humano.',
    escalationBoundary: 'Esta é uma prévia determinística. Ela não chama IA, pesquisa a web, envia mensagens, agenda eventos nem conecta calendários.',
    savePending: 'Salvando rascunho…',
    publishPending: 'Publicando…',
    draftSaved: 'Rascunho salvo.',
    published: 'Publicado.',
    forbidden: 'Esta conta não pode alterar o perfil da Organização ativa.',
    invalid: 'Revise os campos marcados do perfil.',
    notFound: 'Essa versão do perfil não está disponível na Organização ativa.',
    personalNotSaved: 'A configuração Pessoal permanece local no navegador e não foi salva.',
    noDraft: 'Salve um rascunho e recarregue o Studio antes de publicar essa versão.',
    languageLabel: 'Idioma',
    segments: { church: 'Igreja', clinic: 'Clínica', restaurant: 'Restaurante', real_estate: 'Imobiliária', general: 'Organização geral' },
    tones: { warm: 'Acolhedor', professional: 'Profissional', concise: 'Conciso' },
    capabilities: { knowledge: 'Conhecimento verificado', calendar: 'Rascunho com agenda', confidential_request: 'Coleta confidencial', escalation: 'Encaminhamento humano' },
  },
};

function actionFeedback(state: StudioActionState, copy: StudioCopy): string {
  if (state.ok === 'draftSaved') return copy.draftSaved;
  if (state.ok === 'published') return copy.published;
  if (state.error) return copy[state.error];
  return '';
}

export function SecretaryStudio({
  initialProfile,
  kind,
  locale,
  messages,
  versionId,
}: SecretaryStudioProps) {
  const [profile, setProfile] = useState(() => parseSecretaryProfile(initialProfile));
  const [publishState, setPublishState] = useState<StudioActionState>(EMPTY_ACTION_STATE);
  const [publishPending, startPublish] = useTransition();
  const copy = STUDIO_COPY[locale];
  const scenario = STUDIO_SCENARIOS[profile.segment];
  const preview = buildStudioPreview(profile, scenario);
  const isPersonal = kind === 'personal';
  const [saveState, saveAction, savePending] = useActionState(
    async (_previous: StudioActionState, formData: FormData) => (
      saveStudioDraft(kind, formData)
    ),
    EMPTY_ACTION_STATE,
  );

  function setField<K extends keyof SecretaryProfile>(
    field: K,
    value: SecretaryProfile[K],
  ) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  function toggleCapability(capability: Capability, checked: boolean) {
    setProfile((current) => ({
      ...current,
      enabledCapabilities: checked
        ? [...new Set([...current.enabledCapabilities, capability])]
        : current.enabledCapabilities.filter((item) => item !== capability),
    }));
  }

  function publishCurrentVersion() {
    if (!versionId) {
      setPublishState({ error: 'notFound' });
      return;
    }
    startPublish(async () => {
      setPublishState(await publishStudioProfile(kind, versionId));
    });
  }

  return (
    <main className="min-h-screen bg-[#f4f7f5] text-[#102421]">
      <header className="border-b border-[#102421]/15 bg-[#102421] text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center bg-[#6ee7b7] font-mono text-sm font-bold text-[#102421]" aria-hidden="true">M</span>
            <div>
              <p className="font-mono text-[0.66rem] uppercase tracking-[0.22em] text-[#6ee7b7]">MORDOMO</p>
              <h1 className="text-sm font-semibold">{copy.studio}</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link className="border border-white/25 px-3 py-2 text-xs font-semibold hover:border-[#6ee7b7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7]" href={`/${locale}/onboarding`}>
              {messages.context.switchLabel}: {isPersonal ? messages.context.personal : messages.context.organization}
            </Link>
            <nav aria-label={copy.languageLabel} className="flex items-center gap-1 font-mono text-xs">
              <Link className={`px-2 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7] ${locale === 'en' ? 'bg-[#6ee7b7] font-bold text-[#102421]' : ''}`} href={`/en/studio?context=${kind}`}>EN</Link>
              <span aria-hidden="true" className="text-white/35">/</span>
              <Link className={`px-2 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7] ${locale === 'pt' ? 'bg-[#6ee7b7] font-bold text-[#102421]' : ''}`} href={`/pt/studio?context=${kind}`}>PT</Link>
            </nav>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)] lg:items-start">
        <form action={saveAction} className="border border-[#102421]/15 bg-white">
          <div className="flex items-center justify-between border-b border-[#102421]/15 px-5 py-4 sm:px-7">
            <div>
              <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[#167052]">{copy.configure}</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{messages.profile.title}</h2>
            </div>
            <span className="bg-[#e0f2fe] px-3 py-1 font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em]">{copy.context}: {kind}</span>
          </div>

          <div className="grid gap-6 p-5 sm:grid-cols-2 sm:p-7">
            {isPersonal ? (
              <div className="sm:col-span-2">
                <span className="mb-2 block text-sm font-semibold">{copy.segment}</span>
                <input name="segment" type="hidden" value="personal" />
                <p className="border border-[#102421]/15 bg-[#f4f7f5] px-4 py-3 text-sm">{messages.context.personal}</p>
              </div>
            ) : (
              <label className="block text-sm font-semibold">
                {copy.segment}
                <select
                  className="mt-2 min-h-11 w-full border border-[#102421]/25 bg-white px-3 font-normal focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7]"
                  name="segment"
                  onChange={(event) => setField('segment', event.target.value as SecretarySegment)}
                  value={profile.segment}
                >
                  {ORGANIZATION_SEGMENTS.map((segment) => <option key={segment} value={segment}>{copy.segments[segment]}</option>)}
                </select>
                <span className="mt-1 block text-xs font-normal text-[#a14232]">{saveState.fieldErrors?.segment}</span>
              </label>
            )}

            <label className="block text-sm font-semibold">
              {messages.profile.assistantName}
              <input
                className="mt-2 min-h-11 w-full border border-[#102421]/25 px-3 font-normal focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7]"
                maxLength={80}
                name="assistantName"
                onChange={(event) => setField('assistantName', event.target.value)}
                required
                value={profile.assistantName}
              />
              <span className="mt-1 block text-xs font-normal text-[#a14232]">{saveState.fieldErrors?.assistantName}</span>
            </label>

            <label className="block text-sm font-semibold">
              {messages.profile.defaultLocale}
              <select
                className="mt-2 min-h-11 w-full border border-[#102421]/25 bg-white px-3 font-normal focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7]"
                name="defaultLocale"
                onChange={(event) => setField('defaultLocale', event.target.value as BetaLocale)}
                value={profile.defaultLocale}
              >
                <option value="en">English</option>
                <option value="pt">Português</option>
              </select>
              <span className="mt-1 block text-xs font-normal text-[#a14232]">{saveState.fieldErrors?.defaultLocale}</span>
            </label>

            <label className="block text-sm font-semibold">
              {messages.profile.replyTone}
              <select
                className="mt-2 min-h-11 w-full border border-[#102421]/25 bg-white px-3 font-normal focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7]"
                name="replyTone"
                onChange={(event) => setField('replyTone', event.target.value as ReplyTone)}
                value={profile.replyTone}
              >
                {REPLY_TONES.map((tone) => <option key={tone} value={tone}>{copy.tones[tone]}</option>)}
              </select>
              <span className="mt-1 block text-xs font-normal text-[#a14232]">{saveState.fieldErrors?.replyTone}</span>
            </label>

            <label className="block text-sm font-semibold sm:col-span-2">
              {messages.profile.greeting}
              <textarea
                className="mt-2 min-h-24 w-full resize-y border border-[#102421]/25 px-3 py-3 font-normal leading-6 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7]"
                maxLength={280}
                name="greeting"
                onChange={(event) => setField('greeting', event.target.value)}
                required
                value={profile.greeting}
              />
              <span className="mt-1 block text-xs font-normal text-[#a14232]">{saveState.fieldErrors?.greeting}</span>
            </label>

            <label className="block text-sm font-semibold sm:col-span-2">
              {messages.profile.escalationCopy}
              <textarea
                className="mt-2 min-h-24 w-full resize-y border border-[#102421]/25 px-3 py-3 font-normal leading-6 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7]"
                maxLength={280}
                name="escalationCopy"
                onChange={(event) => setField('escalationCopy', event.target.value)}
                required
                value={profile.escalationCopy}
              />
              <span className="mt-1 block text-xs font-normal text-[#a14232]">{saveState.fieldErrors?.escalationCopy}</span>
            </label>

            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-semibold">{messages.profile.enabledCapabilities}</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {CAPABILITIES.map((capability) => (
                  <label className="flex min-h-11 items-center gap-3 border border-[#102421]/15 px-3 py-2 text-sm hover:border-[#167052]" key={capability}>
                    <input
                      checked={profile.enabledCapabilities.includes(capability)}
                      className="size-4 accent-[#167052] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#6ee7b7]"
                      name="enabledCapabilities"
                      onChange={(event) => toggleCapability(capability, event.target.checked)}
                      type="checkbox"
                      value={capability}
                    />
                    {copy.capabilities[capability]}
                  </label>
                ))}
              </div>
              <span className="mt-1 block text-xs text-[#a14232]">{saveState.fieldErrors?.enabledCapabilities}</span>
            </fieldset>
          </div>

          <aside className="mx-5 border-l-4 border-[#d9a62e] bg-[#fef3c7] px-4 py-3 text-sm leading-6 sm:mx-7">
            <strong>{copy.betaBoundary}.</strong> {isPersonal ? copy.personalBoundary : copy.organizationBoundary} {locale === 'pt' ? 'Notas privadas e lembretes não são salvos nesta fundação.' : 'Private notes and reminders are not saved in this foundation.'}
          </aside>

          <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:p-7">
            <button
              className="min-h-11 bg-[#102421] px-5 py-3 text-sm font-semibold text-white hover:bg-[#193a34] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#6ee7b7] disabled:cursor-not-allowed disabled:opacity-45"
              disabled={isPersonal || savePending}
              type="submit"
            >
              {savePending ? copy.savePending : messages.profile.saveDraft}
            </button>
            <button
              className="min-h-11 border border-[#102421] bg-white px-5 py-3 text-sm font-semibold hover:bg-[#f4f7f5] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#6ee7b7] disabled:cursor-not-allowed disabled:opacity-45"
              disabled={isPersonal || publishPending || !versionId}
              onClick={publishCurrentVersion}
              type="button"
            >
              {publishPending ? copy.publishPending : messages.profile.publish}
            </button>
            {!isPersonal && !versionId ? <p className="text-xs leading-5 text-[#102421]/60">{copy.noDraft}</p> : null}
          </div>
          <p aria-live="polite" className="min-h-6 px-5 pb-5 text-sm font-semibold text-[#167052] sm:px-7 sm:pb-7">
            {isPersonal ? copy.personalNotSaved : actionFeedback(publishState.ok || publishState.error ? publishState : saveState, copy)}
          </p>
        </form>

        <aside className="border border-[#102421]/20 bg-[#102421] text-white lg:sticky lg:top-6" aria-labelledby="test-rail-title">
          <div className="border-b border-white/15 px-5 py-4">
            <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[#6ee7b7]">TEST / 01</p>
            <h2 className="mt-1 text-xl font-semibold" id="test-rail-title">{copy.testRail}</h2>
          </div>
          <dl className="divide-y divide-white/15">
            <div className="px-5 py-4">
              <dt className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-white/50">{copy.scenario}</dt>
              <dd className="mt-2 text-sm leading-6">{scenario.prompt}</dd>
            </div>
            <div className="grid grid-cols-2 divide-x divide-white/15">
              <div className="px-5 py-4">
                <dt className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-white/50">{copy.result}</dt>
                <dd className="mt-2 font-mono text-xs uppercase text-[#6ee7b7]">{preview.result.kind}</dd>
              </div>
              <div className="px-5 py-4">
                <dt className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-white/50">{copy.capability}</dt>
                <dd className="mt-2 font-mono text-xs uppercase text-[#6ee7b7]">{preview.result.requiredCapability}</dd>
              </div>
            </div>
            <div className="px-5 py-5">
              <dt className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-white/50">{preview.assistantName} · {preview.tone}</dt>
              <dd className="mt-3 border-l-2 border-[#6ee7b7] pl-4">
                <p className="text-sm leading-6 text-white/70">{preview.greeting}</p>
                <p className="mt-3 text-base leading-7">{preview.result.text}</p>
              </dd>
            </div>
            <div className="bg-[#e0f2fe] px-5 py-4 text-[#102421]">
              <dt className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-[#102421]/55">{copy.citation}</dt>
              <dd className="mt-2 text-sm leading-6">
                {preview.result.citation ? <><strong>{preview.result.citation.title}</strong><span className="mt-1 block text-[#102421]/70">{preview.result.citation.excerpt}</span></> : copy.noCitation}
              </dd>
            </div>
          </dl>
          <p className="border-t border-white/15 px-5 py-4 text-xs leading-5 text-white/60">{copy.escalationBoundary}</p>
        </aside>
      </div>
    </main>
  );
}
