ALTER TABLE "reports" ADD COLUMN "generated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE "reports" SET "generated_at" = "created_at";
