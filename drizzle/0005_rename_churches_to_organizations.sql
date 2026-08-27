ALTER TABLE "churches" RENAME TO "organizations";--> statement-breakpoint
ALTER TABLE "budgets" RENAME COLUMN "church_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "chunks" RENAME COLUMN "church_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "church_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "church_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "church_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "messages" RENAME COLUMN "church_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "prayer_requests" RENAME COLUMN "church_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "tickets" RENAME COLUMN "church_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "usage_ledger" RENAME COLUMN "church_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "reports" RENAME COLUMN "church_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "clerk_organization_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "owner_clerk_user_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_clerk_organization_id_unique" UNIQUE("clerk_organization_id");--> statement-breakpoint
ALTER INDEX "chunks_church_idx" RENAME TO "chunks_organization_idx";--> statement-breakpoint
ALTER TABLE "reports" RENAME CONSTRAINT "reports_church_period_key" TO "reports_organization_period_key";--> statement-breakpoint
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
);--> statement-breakpoint
INSERT INTO "organization_profiles" (
  "organization_id", "industry", "default_locale", "assistant_name", "reply_tone",
  "greeting", "escalation_copy", "enabled_capabilities"
)
SELECT
  "id", 'church', 'pt', 'Secretária', 'warm',
  'Olá! Como posso ajudar?', 'Vou encaminhar sua mensagem para a equipe responsável.',
  '["knowledge", "calendar", "confidential_request", "escalation"]'::jsonb
FROM "organizations";
