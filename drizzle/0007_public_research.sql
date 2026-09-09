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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "data_control_events" ADD CONSTRAINT "data_control_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_briefs" ADD CONSTRAINT "research_briefs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_facts" ADD CONSTRAINT "research_facts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_facts" ADD CONSTRAINT "research_facts_brief_id_research_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."research_briefs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_facts" ADD CONSTRAINT "research_facts_source_id_research_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."research_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_brief_id_research_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."research_briefs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_control_events_organization_created_at_idx" ON "data_control_events" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "data_control_events_organization_id_idx" ON "data_control_events" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "research_briefs_organization_created_at_idx" ON "research_briefs" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "research_briefs_organization_id_idx" ON "research_briefs" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_briefs_one_active_organization" ON "research_briefs" USING btree ("organization_id") WHERE "research_briefs"."status" in ('retrieving', 'source_ready', 'proposing');--> statement-breakpoint
CREATE INDEX "research_facts_organization_brief_idx" ON "research_facts" USING btree ("organization_id","brief_id");--> statement-breakpoint
CREATE INDEX "research_facts_organization_id_idx" ON "research_facts" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_sources_one_per_brief" ON "research_sources" USING btree ("organization_id","brief_id");--> statement-breakpoint
CREATE INDEX "research_sources_organization_id_idx" ON "research_sources" USING btree ("organization_id","id");