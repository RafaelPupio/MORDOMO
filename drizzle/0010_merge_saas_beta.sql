-- Compatibility bridge for databases that already ended on main 0006.
-- Existing migrations remain byte-for-byte intact; each complete feature phase runs only when absent.
DO $mordomo$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    IF to_regclass('public.churches') IS NULL THEN
      RAISE EXCEPTION 'Cannot reconcile organization tenancy: neither churches nor organizations exists';
    END IF;
    ALTER TABLE "churches" RENAME TO "organizations";
    ALTER TABLE "budgets" RENAME COLUMN "church_id" TO "organization_id";
    ALTER TABLE "chunks" RENAME COLUMN "church_id" TO "organization_id";
    ALTER TABLE "conversations" RENAME COLUMN "church_id" TO "organization_id";
    ALTER TABLE "documents" RENAME COLUMN "church_id" TO "organization_id";
    ALTER TABLE "events" RENAME COLUMN "church_id" TO "organization_id";
    ALTER TABLE "messages" RENAME COLUMN "church_id" TO "organization_id";
    ALTER TABLE "prayer_requests" RENAME COLUMN "church_id" TO "organization_id";
    ALTER TABLE "tickets" RENAME COLUMN "church_id" TO "organization_id";
    ALTER TABLE "usage_ledger" RENAME COLUMN "church_id" TO "organization_id";
    ALTER TABLE "reports" RENAME COLUMN "church_id" TO "organization_id";
    ALTER TABLE "organizations" RENAME CONSTRAINT "churches_id_not_null" TO "organizations_id_not_null";
    ALTER TABLE "organizations" RENAME CONSTRAINT "churches_slug_not_null" TO "organizations_slug_not_null";
    ALTER TABLE "organizations" RENAME CONSTRAINT "churches_name_not_null" TO "organizations_name_not_null";
    ALTER TABLE "organizations" RENAME CONSTRAINT "churches_created_at_not_null" TO "organizations_created_at_not_null";
    ALTER TABLE "organizations" RENAME CONSTRAINT "churches_pkey" TO "organizations_pkey";
    ALTER TABLE "organizations" RENAME CONSTRAINT "churches_slug_unique" TO "organizations_slug_unique";
    ALTER TABLE "budgets" RENAME CONSTRAINT "budgets_church_id_not_null" TO "budgets_organization_id_not_null";
    ALTER TABLE "chunks" RENAME CONSTRAINT "chunks_church_id_not_null" TO "chunks_organization_id_not_null";
    ALTER TABLE "conversations" RENAME CONSTRAINT "conversations_church_id_not_null" TO "conversations_organization_id_not_null";
    ALTER TABLE "documents" RENAME CONSTRAINT "documents_church_id_not_null" TO "documents_organization_id_not_null";
    ALTER TABLE "events" RENAME CONSTRAINT "events_church_id_not_null" TO "events_organization_id_not_null";
    ALTER TABLE "messages" RENAME CONSTRAINT "messages_church_id_not_null" TO "messages_organization_id_not_null";
    ALTER TABLE "prayer_requests" RENAME CONSTRAINT "prayer_requests_church_id_not_null" TO "prayer_requests_organization_id_not_null";
    ALTER TABLE "tickets" RENAME CONSTRAINT "tickets_church_id_not_null" TO "tickets_organization_id_not_null";
    ALTER TABLE "usage_ledger" RENAME CONSTRAINT "usage_ledger_church_id_not_null" TO "usage_ledger_organization_id_not_null";
    ALTER TABLE "reports" RENAME CONSTRAINT "reports_church_id_not_null" TO "reports_organization_id_not_null";
    ALTER TABLE "budgets" RENAME CONSTRAINT "budgets_church_id_churches_id_fk" TO "budgets_organization_id_organizations_id_fk";
    ALTER TABLE "chunks" RENAME CONSTRAINT "chunks_church_id_churches_id_fk" TO "chunks_organization_id_organizations_id_fk";
    ALTER TABLE "conversations" RENAME CONSTRAINT "conversations_church_id_churches_id_fk" TO "conversations_organization_id_organizations_id_fk";
    ALTER TABLE "documents" RENAME CONSTRAINT "documents_church_id_churches_id_fk" TO "documents_organization_id_organizations_id_fk";
    ALTER TABLE "events" RENAME CONSTRAINT "events_church_id_churches_id_fk" TO "events_organization_id_organizations_id_fk";
    ALTER TABLE "messages" RENAME CONSTRAINT "messages_church_id_churches_id_fk" TO "messages_organization_id_organizations_id_fk";
    ALTER TABLE "prayer_requests" RENAME CONSTRAINT "prayer_requests_church_id_churches_id_fk" TO "prayer_requests_organization_id_organizations_id_fk";
    ALTER TABLE "tickets" RENAME CONSTRAINT "tickets_church_id_churches_id_fk" TO "tickets_organization_id_organizations_id_fk";
    ALTER TABLE "usage_ledger" RENAME CONSTRAINT "usage_ledger_church_id_churches_id_fk" TO "usage_ledger_organization_id_organizations_id_fk";
    ALTER TABLE "reports" RENAME CONSTRAINT "reports_church_id_churches_id_fk" TO "reports_organization_id_organizations_id_fk";
    ALTER TABLE "organizations" ADD COLUMN "clerk_organization_id" text;
    ALTER TABLE "organizations" ADD COLUMN "owner_clerk_user_id" text;
    ALTER TABLE "organizations" ADD CONSTRAINT "organizations_clerk_organization_id_unique" UNIQUE("clerk_organization_id");
    ALTER INDEX "chunks_church_idx" RENAME TO "chunks_organization_idx";
    ALTER TABLE "reports" RENAME CONSTRAINT "reports_church_period_key" TO "reports_organization_period_key";
    CREATE TABLE "organization_profiles" (
      "organization_id" uuid PRIMARY KEY NOT NULL,
      "industry" text NOT NULL,
      "default_locale" text NOT NULL,
      "assistant_name" text NOT NULL,
      "reply_tone" text NOT NULL,
      "greeting" text NOT NULL,
      "escalation_copy" text NOT NULL,
      "enabled_capabilities" jsonb NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "organization_profiles_organization_id_organizations_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action
    );
    INSERT INTO "organization_profiles" (
      "organization_id", "industry", "default_locale", "assistant_name", "reply_tone",
      "greeting", "escalation_copy", "enabled_capabilities"
    )
    SELECT
      "id", 'church', 'pt', 'Secretária', 'warm',
      'Olá! Como posso ajudar?', 'Vou encaminhar sua mensagem para a equipe responsável.',
      '["knowledge", "calendar", "confidential_request", "escalation"]'::jsonb
    FROM "organizations";
  END IF;
  IF to_regclass('public.organization_profiles') IS NULL THEN
    RAISE EXCEPTION 'Cannot reconcile organization tenancy: organization_profiles is missing from a partial migration';
  END IF;
END $mordomo$;
--> statement-breakpoint
DO $mordomo$
BEGIN
  IF to_regclass('public.personal_contexts') IS NULL
     AND to_regclass('public.secretary_profile_versions') IS NULL THEN
    CREATE TABLE "personal_contexts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "clerk_user_id" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "personal_contexts_clerk_user_id_unique" UNIQUE("clerk_user_id")
    );

    CREATE TABLE "secretary_profile_versions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "organization_id" uuid NOT NULL,
      "status" text DEFAULT 'draft' NOT NULL,
      "profile" jsonb NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );

    ALTER TABLE "secretary_profile_versions" ADD CONSTRAINT "secretary_profile_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
    CREATE INDEX "secretary_profile_versions_organization_created_at_idx" ON "secretary_profile_versions" USING btree ("organization_id","created_at" DESC NULLS LAST);
    CREATE UNIQUE INDEX "secretary_profile_versions_one_published_organization" ON "secretary_profile_versions" USING btree ("organization_id") WHERE "secretary_profile_versions"."status" = 'published';
  ELSIF to_regclass('public.personal_contexts') IS NULL
     OR to_regclass('public.secretary_profile_versions') IS NULL THEN
    RAISE EXCEPTION 'Cannot reconcile Studio tables from a partial migration';
  END IF;
END $mordomo$;
--> statement-breakpoint
DO $mordomo$
BEGIN
  IF to_regclass('public.data_control_events') IS NULL
     AND to_regclass('public.research_briefs') IS NULL
     AND to_regclass('public.research_facts') IS NULL
     AND to_regclass('public.research_sources') IS NULL THEN
    CREATE TABLE "data_control_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "organization_id" uuid NOT NULL,
      "actor_clerk_user_id" text NOT NULL,
      "action" text NOT NULL,
      "target_type" text NOT NULL,
      "target_id" text NOT NULL,
      "outcome" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "data_control_events_actor_length_check" CHECK (char_length("data_control_events"."actor_clerk_user_id") between 1 and 255),
      CONSTRAINT "data_control_events_action_check" CHECK ("data_control_events"."action" in ('research.started', 'research.source', 'research.proposed', 'research.reviewed', 'research.applied')),
      CONSTRAINT "data_control_events_target_type_check" CHECK ("data_control_events"."target_type" in ('research_brief', 'research_fact', 'profile_version')),
      CONSTRAINT "data_control_events_target_id_length_check" CHECK (char_length("data_control_events"."target_id") between 1 and 128),
      CONSTRAINT "data_control_events_outcome_check" CHECK ("data_control_events"."outcome" in ('succeeded', 'failed'))
    );

    CREATE TABLE "research_briefs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "organization_id" uuid NOT NULL,
      "requested_by_clerk_user_id" text NOT NULL,
      "segment" text NOT NULL,
      "city" text,
      "locale" text NOT NULL,
      "requested_url" text NOT NULL,
      "consent_version" text NOT NULL,
      "consented_at" timestamp NOT NULL,
      "proposal_attempts" integer DEFAULT 0 NOT NULL,
      "status" text DEFAULT 'retrieving' NOT NULL,
      "error_code" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "research_briefs_segment_check" CHECK ("research_briefs"."segment" in ('church', 'clinic', 'restaurant', 'real_estate', 'general')),
      CONSTRAINT "research_briefs_city_length_check" CHECK ("research_briefs"."city" is null or char_length("research_briefs"."city") <= 120),
      CONSTRAINT "research_briefs_locale_check" CHECK ("research_briefs"."locale" in ('en', 'pt')),
      CONSTRAINT "research_briefs_url_length_check" CHECK (char_length("research_briefs"."requested_url") between 1 and 2048),
      CONSTRAINT "research_briefs_consent_length_check" CHECK (char_length("research_briefs"."consent_version") between 1 and 80),
      CONSTRAINT "research_briefs_proposal_attempts_check" CHECK ("research_briefs"."proposal_attempts" between 0 and 3),
      CONSTRAINT "research_briefs_status_check" CHECK ("research_briefs"."status" in ('retrieving', 'source_ready', 'proposing', 'review_ready', 'failed', 'applied')),
      CONSTRAINT "research_briefs_error_code_check" CHECK ("research_briefs"."error_code" is null or "research_briefs"."error_code" in ('researchUnavailable', 'forbidden', 'invalidInput', 'unsafeUrl', 'rateLimited', 'budgetExhausted', 'providerUnavailable', 'retentionUnverified', 'noUsefulContent', 'proposalFailed', 'ungroundedProposal', 'staleResearchState', 'notFound'))
    );

    CREATE TABLE "research_facts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "organization_id" uuid NOT NULL,
      "brief_id" uuid NOT NULL,
      "source_id" uuid NOT NULL,
      "proposed_text" text NOT NULL,
      "supporting_quote" text NOT NULL,
      "review_status" text DEFAULT 'proposed' NOT NULL,
      "accepted_text" text,
      "reviewed_by_clerk_user_id" text,
      "reviewed_at" timestamp,
      "created_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "research_facts_proposed_text_length_check" CHECK (char_length("research_facts"."proposed_text") between 1 and 280),
      CONSTRAINT "research_facts_supporting_quote_length_check" CHECK (char_length("research_facts"."supporting_quote") between 1 and 500),
      CONSTRAINT "research_facts_accepted_text_length_check" CHECK ("research_facts"."accepted_text" is null or char_length("research_facts"."accepted_text") between 1 and 280),
      CONSTRAINT "research_facts_review_status_check" CHECK ("research_facts"."review_status" in ('proposed', 'accepted', 'rejected')),
      CONSTRAINT "research_facts_review_shape" CHECK (
        ("research_facts"."review_status" = 'proposed' and "research_facts"."accepted_text" is null and "research_facts"."reviewed_by_clerk_user_id" is null and "research_facts"."reviewed_at" is null)
        or ("research_facts"."review_status" = 'accepted' and "research_facts"."accepted_text" is not null and "research_facts"."reviewed_by_clerk_user_id" is not null and "research_facts"."reviewed_at" is not null)
        or ("research_facts"."review_status" = 'rejected' and "research_facts"."accepted_text" is null and "research_facts"."reviewed_by_clerk_user_id" is not null and "research_facts"."reviewed_at" is not null)
      )
    );

    CREATE TABLE "research_sources" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "organization_id" uuid NOT NULL,
      "brief_id" uuid NOT NULL,
      "url" text NOT NULL,
      "title" text NOT NULL,
      "excerpt" text NOT NULL,
      "retrieved_at" timestamp NOT NULL,
      CONSTRAINT "research_sources_url_length_check" CHECK (char_length("research_sources"."url") between 1 and 2048),
      CONSTRAINT "research_sources_title_length_check" CHECK (char_length("research_sources"."title") between 1 and 200),
      CONSTRAINT "research_sources_excerpt_length_check" CHECK (char_length("research_sources"."excerpt") between 1 and 40000)
    );

    ALTER TABLE "data_control_events" ADD CONSTRAINT "data_control_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
    ALTER TABLE "research_briefs" ADD CONSTRAINT "research_briefs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
    ALTER TABLE "research_facts" ADD CONSTRAINT "research_facts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
    ALTER TABLE "research_facts" ADD CONSTRAINT "research_facts_brief_id_research_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."research_briefs"("id") ON DELETE no action ON UPDATE no action;
    ALTER TABLE "research_facts" ADD CONSTRAINT "research_facts_source_id_research_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."research_sources"("id") ON DELETE no action ON UPDATE no action;
    ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
    ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_brief_id_research_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."research_briefs"("id") ON DELETE no action ON UPDATE no action;
    CREATE INDEX "data_control_events_organization_created_at_idx" ON "data_control_events" USING btree ("organization_id","created_at" DESC NULLS LAST);
    CREATE INDEX "data_control_events_organization_id_idx" ON "data_control_events" USING btree ("organization_id","id");
    CREATE INDEX "research_briefs_organization_created_at_idx" ON "research_briefs" USING btree ("organization_id","created_at" DESC NULLS LAST);
    CREATE INDEX "research_briefs_organization_id_idx" ON "research_briefs" USING btree ("organization_id","id");
    CREATE UNIQUE INDEX "research_briefs_one_active_organization" ON "research_briefs" USING btree ("organization_id") WHERE "research_briefs"."status" in ('retrieving', 'source_ready', 'proposing');
    CREATE INDEX "research_facts_organization_brief_idx" ON "research_facts" USING btree ("organization_id","brief_id");
    CREATE INDEX "research_facts_organization_id_idx" ON "research_facts" USING btree ("organization_id","id");
    CREATE UNIQUE INDEX "research_sources_one_per_brief" ON "research_sources" USING btree ("organization_id","brief_id");
    CREATE INDEX "research_sources_organization_id_idx" ON "research_sources" USING btree ("organization_id","id");
  ELSIF to_regclass('public.data_control_events') IS NULL
     OR to_regclass('public.research_briefs') IS NULL
     OR to_regclass('public.research_facts') IS NULL
     OR to_regclass('public.research_sources') IS NULL THEN
    RAISE EXCEPTION 'Cannot reconcile public research tables from a partial migration';
  END IF;
END $mordomo$;
