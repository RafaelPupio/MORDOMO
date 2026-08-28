CREATE TABLE "personal_contexts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clerk_user_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "personal_contexts_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "secretary_profile_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "profile" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "secretary_profile_versions_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "secretary_profile_versions_organization_created_at_idx"
  ON "secretary_profile_versions" USING btree ("organization_id", "created_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX "secretary_profile_versions_one_published_organization"
  ON "secretary_profile_versions" ("organization_id")
  WHERE "status" = 'published';
