ALTER TABLE "documents" ADD COLUMN "ingest_error" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "source_text" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "extraction_confidence" real;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "verification_note" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source_quote" text;