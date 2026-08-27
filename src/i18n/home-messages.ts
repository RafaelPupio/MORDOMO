import { PRODUCT_NAME } from '@/brand';
import type { Locale } from '@/i18n/locales';

export type CapabilityTone = 'mint' | 'sky' | 'amber';

type Cta = {
  label: string;
  href: '/chat' | '/staff';
};

type Capability = {
  name: string;
  home: string;
  detail: string;
  tone: CapabilityTone;
};

export type HomeMessages = {
  metadata: { title: string; description: string };
  languageLabel: string;
  languageOptions: Array<{ locale: Locale; label: string }>;
  codeLink: string;
  hero: {
    eyebrow: string;
    title: string;
    intro: string;
    demoNote: string;
    primaryCta: Cta;
    secondaryCta: Cta;
  };
  facts: Array<{ label: string; value: string }>;
  diagram: {
    eyebrow: string;
    visitor: { eyebrow: string; title: string; copy: string };
    documents: { eyebrow: string; title: string; copy: string };
    reports: { eyebrow: string; title: string; copy: string };
    rationale: string;
  };
  capabilitySection: { eyebrow: string; title: string; copy: string };
  capabilities: Capability[];
  proof: { eyebrow: string; title: string; copy: string; question: string; answer: string; citation: string };
  closing: { eyebrow: string; title: string; copy: string; code: string; spec: string; plans: string };
  footer: string;
};

const languageOptions: HomeMessages['languageOptions'] = [
  { locale: 'en', label: 'English' },
  { locale: 'pt', label: 'Português' },
  { locale: 'es', label: 'Español' },
  { locale: 'fr', label: 'Français' },
  { locale: 'de', label: 'Deutsch' },
];

export const HOME_MESSAGES: Record<Locale, HomeMessages> = {
  en: {
    metadata: { title: 'MORDOMO — accountable AI secretary', description: 'A multilingual AI secretary for organizations that answers from verified knowledge and keeps people in control.' },
    languageLabel: 'Choose presentation language',
    languageOptions,
    codeLink: 'View the code',
    hero: {
      eyebrow: 'AI secretary · portfolio build',
      title: `${PRODUCT_NAME} is an AI secretary that shows its work.`,
      intro: `${PRODUCT_NAME} helps organizations answer from their own documents, cite the source, and keep staff in the final decision.`,
      demoNote: 'The fictional Igreja da Colina is one demo preset. Its documents and people are invented; the architecture is real.',
      primaryCta: { label: 'Try the visitor chat', href: '/chat' },
      secondaryCta: { label: 'Open staff area', href: '/staff' },
    },
    facts: [
      { label: 'Grounding', value: 'Cited RAG' },
      { label: 'Guardrail', value: 'Human approval' },
      { label: 'Beta', value: 'Invite-only build' },
    ],
    diagram: {
      eyebrow: 'From question to accountable answer',
      visitor: { eyebrow: 'Fast path · one agent', title: 'A visitor asks a question', copy: 'Secretary agent → knowledge search / calendar / confidential request / escalation → cited reply.' },
      documents: { eyebrow: 'Async · two agents', title: 'A document becomes trusted knowledge', copy: 'Parser → extractor → verifier → published facts and source provenance.' },
      reports: { eyebrow: 'Weekly · two agents', title: 'Staff sees the signal', copy: 'Analyst → writer → a private, privacy-bounded weekly digest.' },
      rationale: 'The design choice is deliberate: one agent keeps the live conversation quick. A second pass appears only where it can improve trust—verifying source extraction and reviewing a weekly summary.',
    },
    capabilitySection: { eyebrow: 'Capability map', title: 'Ten capabilities. Each earns a real home.', copy: 'This is not a feature wishlist. MORDOMO connects practical AI capabilities through organization scoping, usage metering, reviewable workflows, and visible provenance.' },
    capabilities: [
      { name: 'AI chatbot', home: 'Visitor chat', detail: 'Streams replies in the visitor’s language.', tone: 'mint' },
      { name: 'AI agent', home: 'Secretary', detail: 'Uses bounded tools instead of inventing facts.', tone: 'mint' },
      { name: 'RAG', home: 'Knowledge search', detail: 'Grounds answers in documents with citations.', tone: 'mint' },
      { name: 'Knowledge base', home: 'Organization corpus', detail: 'Scoped chunks, embeddings, and source provenance.', tone: 'mint' },
      { name: 'Document processing', home: 'Ingest', detail: 'Parses PDF and Markdown before publication.', tone: 'sky' },
      { name: 'Data extraction', home: 'Extractor', detail: 'Finds candidate calendar events in source material.', tone: 'sky' },
      { name: 'Multi-agent system', home: 'Verifier', detail: 'A second model audits each extracted event.', tone: 'sky' },
      { name: 'Workflow automation', home: 'Pipeline + cron', detail: 'Ingest and weekly reporting have explicit stages.', tone: 'sky' },
      { name: 'AI reporting', home: 'Weekly digest', detail: 'An analyst finds patterns; a writer prepares staff context.', tone: 'amber' },
      { name: 'AI support', home: 'Staff inbox', detail: 'Grounded draft replies stay editable and human-approved.', tone: 'amber' },
    ],
    proof: {
      eyebrow: 'What a visitor sees',
      title: 'Answers with receipts.',
      copy: 'The secretary does not claim a service time or event date from memory. It retrieves relevant material first and gives the visitor a citation they can inspect.',
      question: '“What time is the Sunday service?”',
      answer: 'The Sunday services are at 10:00 and 18:30. If you need help getting there, I can share the address too.',
      citation: 'Horários e Contato — Igreja da Colina',
    },
    closing: { eyebrow: 'Product status', title: 'A real beta foundation, ready to be shaped by clients.', copy: 'MORDOMO already combines grounded chat, document review, human approval, cost controls, and organization-ready architecture. The next beta step is invite-only workspace configuration—not a promise of features that do not exist.', code: 'Repository', spec: 'Design spec', plans: 'Implementation plans' },
    footer: `Built as a portfolio project by Rafael Pupio Vieira · ${PRODUCT_NAME} uses fictional demo data and real engineering decisions.`,
  },
  pt: {
    metadata: { title: 'MORDOMO — secretaria de IA responsável', description: 'Uma secretaria de IA multilíngue para organizações, baseada em conhecimento verificado e com pessoas no controle.' },
    languageLabel: 'Escolha o idioma da apresentação',
    languageOptions,
    codeLink: 'Ver o código',
    hero: {
      eyebrow: 'Secretaria de IA · projeto de portfólio',
      title: `${PRODUCT_NAME} é uma secretaria de IA que mostra como trabalha.`,
      intro: `${PRODUCT_NAME} ajuda organizações a responder com base nos próprios documentos, citar a fonte e manter a equipe na decisão final.`,
      demoNote: 'A Igreja da Colina fictícia é apenas uma configuração de demonstração. Seus documentos e pessoas são inventados; a arquitetura é real.',
      primaryCta: { label: 'Experimentar o chat do visitante', href: '/chat' },
      secondaryCta: { label: 'Abrir área da equipe', href: '/staff' },
    },
    facts: [
      { label: 'Base', value: 'RAG com citações' },
      { label: 'Proteção', value: 'Aprovação humana' },
      { label: 'Beta', value: 'Acesso por convite' },
    ],
    diagram: {
      eyebrow: 'Da pergunta à resposta responsável',
      visitor: { eyebrow: 'Caminho rápido · um agente', title: 'Uma pessoa faz uma pergunta', copy: 'Agente secretário → busca de conhecimento / agenda / pedido confidencial / encaminhamento → resposta citada.' },
      documents: { eyebrow: 'Assíncrono · dois agentes', title: 'Um documento vira conhecimento confiável', copy: 'Leitor → extrator → verificador → fatos publicados e origem da fonte.' },
      reports: { eyebrow: 'Semanal · dois agentes', title: 'A equipe enxerga o que importa', copy: 'Analista → redator → resumo semanal privado, com limites de privacidade.' },
      rationale: 'A escolha é intencional: um agente mantém a conversa ao vivo rápida. Uma segunda etapa só aparece quando aumenta a confiança—na verificação de extrações e na revisão do resumo semanal.',
    },
    capabilitySection: { eyebrow: 'Mapa de capacidades', title: 'Dez capacidades. Cada uma com função real.', copy: 'Isto não é uma lista de desejos. MORDOMO conecta capacidades práticas de IA com escopo por organização, medição de uso, fluxos revisáveis e proveniência visível.' },
    capabilities: [
      { name: 'Chatbot de IA', home: 'Chat do visitante', detail: 'Transmite respostas no idioma do visitante.', tone: 'mint' },
      { name: 'Agente de IA', home: 'Secretário', detail: 'Usa ferramentas limitadas em vez de inventar fatos.', tone: 'mint' },
      { name: 'RAG', home: 'Busca de conhecimento', detail: 'Baseia respostas em documentos com citações.', tone: 'mint' },
      { name: 'Base de conhecimento', home: 'Corpus da organização', detail: 'Trechos, embeddings e origem da fonte por organização.', tone: 'mint' },
      { name: 'Processamento de documentos', home: 'Entrada', detail: 'Lê PDF e Markdown antes da publicação.', tone: 'sky' },
      { name: 'Extração de dados', home: 'Extrator', detail: 'Encontra eventos candidatos no material de origem.', tone: 'sky' },
      { name: 'Sistema multiagente', home: 'Verificador', detail: 'Um segundo modelo audita cada evento extraído.', tone: 'sky' },
      { name: 'Automação de fluxos', home: 'Pipeline + cron', detail: 'Entrada e relatórios semanais têm etapas explícitas.', tone: 'sky' },
      { name: 'Relatórios com IA', home: 'Resumo semanal', detail: 'Um analista encontra padrões; um redator prepara contexto.', tone: 'amber' },
      { name: 'Suporte com IA', home: 'Caixa da equipe', detail: 'Rascunhos fundamentados continuam editáveis e aprovados por pessoas.', tone: 'amber' },
    ],
    proof: { eyebrow: 'O que o visitante vê', title: 'Respostas com comprovantes.', copy: 'A secretaria não afirma um horário de serviço ou data de evento de memória. Ela recupera o material relevante primeiro e oferece uma citação que a pessoa pode conferir.', question: '“Que horas é o culto de domingo?”', answer: 'Os cultos de domingo são às 10:00 e às 18:30. Se precisar de ajuda para chegar, também posso compartilhar o endereço.', citation: 'Horários e Contato — Igreja da Colina' },
    closing: { eyebrow: 'Situação do produto', title: 'Uma base beta real, pronta para ganhar a forma de cada cliente.', copy: 'MORDOMO já combina chat fundamentado, revisão de documentos, aprovação humana, controle de custos e arquitetura preparada para organizações. O próximo passo é configurar espaços por convite—não prometer funções que não existem.', code: 'Repositório', spec: 'Especificação de design', plans: 'Planos de implementação' },
    footer: `Construído como projeto de portfólio por Rafael Pupio Vieira · ${PRODUCT_NAME} usa dados fictícios e decisões reais de engenharia.`,
  },
  es: {
    metadata: { title: 'MORDOMO — secretaría de IA responsable', description: 'Una secretaría de IA multilingüe para organizaciones que responde con conocimiento verificado y mantiene a las personas al mando.' },
    languageLabel: 'Elige el idioma de la presentación',
    languageOptions,
    codeLink: 'Ver el código',
    hero: { eyebrow: 'Secretaría de IA · proyecto de portafolio', title: `${PRODUCT_NAME} es una secretaría de IA que muestra cómo trabaja.`, intro: `${PRODUCT_NAME} ayuda a las organizaciones a responder desde sus propios documentos, citar la fuente y conservar la decisión final en manos del equipo.`, demoNote: 'La ficticia Igreja da Colina es solo una configuración de demostración. Sus documentos y personas son inventados; la arquitectura es real.', primaryCta: { label: 'Probar el chat de visitantes', href: '/chat' }, secondaryCta: { label: 'Abrir área del equipo', href: '/staff' } },
    facts: [{ label: 'Base', value: 'RAG con citas' }, { label: 'Protección', value: 'Aprobación humana' }, { label: 'Beta', value: 'Solo con invitación' }],
    diagram: { eyebrow: 'De la pregunta a una respuesta responsable', visitor: { eyebrow: 'Ruta rápida · un agente', title: 'Una persona hace una pregunta', copy: 'Agente secretario → búsqueda de conocimiento / calendario / solicitud confidencial / derivación → respuesta citada.' }, documents: { eyebrow: 'Asíncrono · dos agentes', title: 'Un documento se vuelve conocimiento fiable', copy: 'Analizador → extractor → verificador → hechos publicados y procedencia de la fuente.' }, reports: { eyebrow: 'Semanal · dos agentes', title: 'El equipo ve la señal', copy: 'Analista → redactor → resumen semanal privado y limitado por privacidad.' }, rationale: 'La decisión es deliberada: un agente mantiene ágil la conversación en vivo. Una segunda revisión solo aparece cuando puede aumentar la confianza—al verificar extracciones y revisar el resumen semanal.' },
    capabilitySection: { eyebrow: 'Mapa de capacidades', title: 'Diez capacidades. Cada una tiene un lugar real.', copy: 'No es una lista de deseos. MORDOMO conecta capacidades prácticas de IA mediante alcance por organización, medición de uso, flujos revisables y procedencia visible.' },
    capabilities: [
      { name: 'Chatbot de IA', home: 'Chat de visitantes', detail: 'Responde en el idioma del visitante.', tone: 'mint' }, { name: 'Agente de IA', home: 'Secretario', detail: 'Usa herramientas delimitadas en vez de inventar hechos.', tone: 'mint' }, { name: 'RAG', home: 'Búsqueda de conocimiento', detail: 'Fundamenta respuestas en documentos con citas.', tone: 'mint' }, { name: 'Base de conocimiento', home: 'Corpus de la organización', detail: 'Fragmentos, embeddings y procedencia por organización.', tone: 'mint' }, { name: 'Procesamiento documental', home: 'Ingesta', detail: 'Analiza PDF y Markdown antes de publicar.', tone: 'sky' }, { name: 'Extracción de datos', home: 'Extractor', detail: 'Encuentra eventos candidatos en el material fuente.', tone: 'sky' }, { name: 'Sistema multiagente', home: 'Verificador', detail: 'Un segundo modelo audita cada evento extraído.', tone: 'sky' }, { name: 'Automatización de flujos', home: 'Pipeline + cron', detail: 'La ingesta y los informes semanales tienen etapas explícitas.', tone: 'sky' }, { name: 'Informes con IA', home: 'Resumen semanal', detail: 'Un analista descubre patrones; un redactor prepara contexto.', tone: 'amber' }, { name: 'Soporte con IA', home: 'Bandeja del equipo', detail: 'Los borradores fundamentados siguen siendo editables y aprobados por personas.', tone: 'amber' },
    ],
    proof: { eyebrow: 'Lo que ve un visitante', title: 'Respuestas con comprobantes.', copy: 'La secretaría no afirma un horario o fecha de evento de memoria. Primero recupera material relevante y entrega una cita que la persona puede revisar.', question: '“¿A qué hora es el servicio del domingo?”', answer: 'Los servicios del domingo son a las 10:00 y 18:30. Si necesitas ayuda para llegar, también puedo compartir la dirección.', citation: 'Horários e Contato — Igreja da Colina' },
    closing: { eyebrow: 'Estado del producto', title: 'Una base beta real, lista para adaptarse a cada cliente.', copy: 'MORDOMO ya reúne chat fundamentado, revisión de documentos, aprobación humana, controles de coste y arquitectura preparada para organizaciones. El siguiente paso beta es configurar espacios solo con invitación—no prometer funciones inexistentes.', code: 'Repositorio', spec: 'Especificación de diseño', plans: 'Planes de implementación' },
    footer: `Construido como proyecto de portafolio por Rafael Pupio Vieira · ${PRODUCT_NAME} usa datos ficticios y decisiones reales de ingeniería.`,
  },
  fr: {
    metadata: { title: 'MORDOMO — secrétariat IA responsable', description: 'Un secrétariat IA multilingue pour les organisations, fondé sur des connaissances vérifiées et laissant la décision aux personnes.' },
    languageLabel: 'Choisir la langue de présentation',
    languageOptions,
    codeLink: 'Voir le code',
    hero: { eyebrow: 'Secrétariat IA · projet de portfolio', title: `${PRODUCT_NAME} est un secrétariat IA qui montre son travail.`, intro: `${PRODUCT_NAME} aide les organisations à répondre à partir de leurs propres documents, à citer la source et à laisser la décision finale à l’équipe.`, demoNote: 'La fictive Igreja da Colina n’est qu’un exemple de démonstration. Ses documents et ses personnes sont inventés ; l’architecture est réelle.', primaryCta: { label: 'Essayer le chat visiteur', href: '/chat' }, secondaryCta: { label: 'Ouvrir l’espace équipe', href: '/staff' } },
    facts: [{ label: 'Ancrage', value: 'RAG avec citations' }, { label: 'Garde-fou', value: 'Validation humaine' }, { label: 'Bêta', value: 'Sur invitation' }],
    diagram: { eyebrow: 'De la question à une réponse responsable', visitor: { eyebrow: 'Voie rapide · un agent', title: 'Un visiteur pose une question', copy: 'Agent secrétaire → recherche / agenda / demande confidentielle / escalade → réponse citée.' }, documents: { eyebrow: 'Asynchrone · deux agents', title: 'Un document devient une connaissance fiable', copy: 'Analyseur → extracteur → vérificateur → faits publiés et provenance.' }, reports: { eyebrow: 'Hebdomadaire · deux agents', title: 'L’équipe voit le signal', copy: 'Analyste → rédacteur → synthèse hebdomadaire privée et limitée par la confidentialité.' }, rationale: 'Ce choix est délibéré : un agent garde la conversation rapide. Une seconde passe n’intervient que lorsqu’elle renforce la confiance—pour vérifier les extractions et relire la synthèse hebdomadaire.' },
    capabilitySection: { eyebrow: 'Carte des capacités', title: 'Dix capacités. Chacune a une vraie fonction.', copy: 'Ce n’est pas une liste de souhaits. MORDOMO relie des capacités IA utiles par périmètre d’organisation, mesure d’usage, flux révisables et provenance visible.' },
    capabilities: [
      { name: 'Chatbot IA', home: 'Chat visiteur', detail: 'Répond dans la langue du visiteur.', tone: 'mint' }, { name: 'Agent IA', home: 'Secrétaire', detail: 'Utilise des outils bornés au lieu d’inventer des faits.', tone: 'mint' }, { name: 'RAG', home: 'Recherche de connaissances', detail: 'Ancre les réponses dans des documents avec citations.', tone: 'mint' }, { name: 'Base de connaissances', home: 'Corpus de l’organisation', detail: 'Extraits, embeddings et provenance par organisation.', tone: 'mint' }, { name: 'Traitement documentaire', home: 'Ingestion', detail: 'Analyse PDF et Markdown avant publication.', tone: 'sky' }, { name: 'Extraction de données', home: 'Extracteur', detail: 'Repère les événements candidats dans les sources.', tone: 'sky' }, { name: 'Système multi-agent', home: 'Vérificateur', detail: 'Un second modèle contrôle chaque événement extrait.', tone: 'sky' }, { name: 'Automatisation de flux', home: 'Pipeline + cron', detail: 'Ingestion et rapport hebdomadaire ont des étapes explicites.', tone: 'sky' }, { name: 'Rapports IA', home: 'Synthèse hebdomadaire', detail: 'Un analyste trouve les tendances ; un rédacteur prépare le contexte.', tone: 'amber' }, { name: 'Support IA', home: 'Boîte équipe', detail: 'Les brouillons sourcés restent modifiables et validés par une personne.', tone: 'amber' },
    ],
    proof: { eyebrow: 'Ce que voit le visiteur', title: 'Des réponses avec justificatifs.', copy: 'Le secrétariat n’affirme pas un horaire ou une date de mémoire. Il récupère d’abord le contenu pertinent et fournit une citation consultable.', question: '« À quelle heure est le service du dimanche ? »', answer: 'Les services du dimanche sont à 10:00 et 18:30. Si vous avez besoin d’aide pour venir, je peux aussi partager l’adresse.', citation: 'Horários e Contato — Igreja da Colina' },
    closing: { eyebrow: 'État du produit', title: 'Une vraie fondation bêta, prête à prendre la forme de chaque client.', copy: 'MORDOMO réunit déjà chat sourcé, revue documentaire, validation humaine, maîtrise des coûts et architecture multi-organisation. La prochaine étape est la configuration d’espaces sur invitation—pas la promesse de fonctionnalités absentes.', code: 'Dépôt', spec: 'Spécification de conception', plans: 'Plans d’implémentation' },
    footer: `Construit comme projet de portfolio par Rafael Pupio Vieira · ${PRODUCT_NAME} utilise des données fictives et de vraies décisions d’ingénierie.`,
  },
  de: {
    metadata: { title: 'MORDOMO — verantwortliche KI-Sekretariatsassistenz', description: 'Eine mehrsprachige KI-Sekretariatsassistenz für Organisationen, die auf geprüftem Wissen basiert und Menschen die Kontrolle lässt.' },
    languageLabel: 'Präsentationssprache wählen',
    languageOptions,
    codeLink: 'Code ansehen',
    hero: { eyebrow: 'KI-Sekretariat · Portfolio-Projekt', title: `${PRODUCT_NAME} ist eine KI-Sekretariatsassistenz, die ihre Arbeit offenlegt.`, intro: `${PRODUCT_NAME} hilft Organisationen, aus ihren eigenen Dokumenten zu antworten, Quellen zu zitieren und die letzte Entscheidung beim Team zu lassen.`, demoNote: 'Die fiktive Igreja da Colina ist nur eine Demo-Voreinstellung. Ihre Dokumente und Personen sind erfunden; die Architektur ist echt.', primaryCta: { label: 'Besucher-Chat ausprobieren', href: '/chat' }, secondaryCta: { label: 'Teambereich öffnen', href: '/staff' } },
    facts: [{ label: 'Fundierung', value: 'RAG mit Zitaten' }, { label: 'Leitplanke', value: 'Menschliche Freigabe' }, { label: 'Beta', value: 'Nur auf Einladung' }],
    diagram: { eyebrow: 'Von der Frage zur verantwortlichen Antwort', visitor: { eyebrow: 'Schneller Weg · ein Agent', title: 'Ein Besucher stellt eine Frage', copy: 'Sekretariatsagent → Wissenssuche / Kalender / vertrauliche Anfrage / Eskalation → zitierte Antwort.' }, documents: { eyebrow: 'Asynchron · zwei Agenten', title: 'Ein Dokument wird zu verlässlichem Wissen', copy: 'Parser → Extraktor → Prüfer → veröffentlichte Fakten und Quellenherkunft.' }, reports: { eyebrow: 'Wöchentlich · zwei Agenten', title: 'Das Team sieht das Wesentliche', copy: 'Analyst → Autor → private, datenschutzbegrenzte Wochenübersicht.' }, rationale: 'Die Entscheidung ist bewusst: Ein Agent hält das Live-Gespräch schnell. Ein zweiter Durchgang kommt nur hinzu, wenn er Vertrauen stärkt—bei der Prüfung von Extraktionen und der wöchentlichen Zusammenfassung.' },
    capabilitySection: { eyebrow: 'Fähigkeitenkarte', title: 'Zehn Fähigkeiten. Jede hat einen echten Platz.', copy: 'Das ist keine Wunschliste. MORDOMO verbindet praktische KI-Fähigkeiten mit Organisationsgrenzen, Verbrauchsmessung, überprüfbaren Abläufen und sichtbarer Herkunft.' },
    capabilities: [
      { name: 'KI-Chatbot', home: 'Besucher-Chat', detail: 'Antwortet in der Sprache des Besuchers.', tone: 'mint' }, { name: 'KI-Agent', home: 'Sekretariat', detail: 'Nutzt begrenzte Werkzeuge, statt Fakten zu erfinden.', tone: 'mint' }, { name: 'RAG', home: 'Wissenssuche', detail: 'Verankert Antworten in Dokumenten mit Zitaten.', tone: 'mint' }, { name: 'Wissensbasis', home: 'Organisationskorpus', detail: 'Abschnitte, Embeddings und Quellenherkunft je Organisation.', tone: 'mint' }, { name: 'Dokumentenverarbeitung', home: 'Import', detail: 'Verarbeitet PDF und Markdown vor der Veröffentlichung.', tone: 'sky' }, { name: 'Datenextraktion', home: 'Extraktor', detail: 'Findet mögliche Kalenderereignisse im Quellmaterial.', tone: 'sky' }, { name: 'Multi-Agenten-System', home: 'Prüfer', detail: 'Ein zweites Modell prüft jedes extrahierte Ereignis.', tone: 'sky' }, { name: 'Workflow-Automatisierung', home: 'Pipeline + Cron', detail: 'Import und Wochenberichte haben eindeutige Stufen.', tone: 'sky' }, { name: 'KI-Berichte', home: 'Wochenübersicht', detail: 'Ein Analyst erkennt Muster; ein Autor bereitet Kontext auf.', tone: 'amber' }, { name: 'KI-Support', home: 'Team-Inbox', detail: 'Fundierte Entwürfe bleiben bearbeitbar und menschlich freigegeben.', tone: 'amber' },
    ],
    proof: { eyebrow: 'Was Besucher sehen', title: 'Antworten mit Belegen.', copy: 'Die Assistenz behauptet keine Uhrzeit oder ein Datum aus dem Gedächtnis. Sie ruft zuerst relevantes Material ab und liefert eine überprüfbare Quellenangabe.', question: '„Wann ist der Sonntagsgottesdienst?“', answer: 'Die Sonntagsgottesdienste sind um 10:00 und 18:30. Wenn Sie Hilfe bei der Anfahrt brauchen, kann ich auch die Adresse teilen.', citation: 'Horários e Contato — Igreja da Colina' },
    closing: { eyebrow: 'Produktstatus', title: 'Ein echtes Beta-Fundament, bereit für die Form jedes Kunden.', copy: 'MORDOMO vereint bereits fundierten Chat, Dokumentenprüfung, menschliche Freigabe, Kostenkontrolle und organisationsfähige Architektur. Der nächste Beta-Schritt sind konfigurierbare Arbeitsbereiche auf Einladung—keine Versprechen für nicht vorhandene Funktionen.', code: 'Repository', spec: 'Design-Spezifikation', plans: 'Implementierungspläne' },
    footer: `Als Portfolio-Projekt von Rafael Pupio Vieira gebaut · ${PRODUCT_NAME} nutzt fiktive Daten und echte Engineering-Entscheidungen.`,
  },
};

export function getHomeMessages(locale: Locale): HomeMessages {
  return HOME_MESSAGES[locale];
}
