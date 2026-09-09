-- Legacy rows deliberately take the migration timestamp (the column default): their
-- resolution date was never recorded, so a resolved row becomes eligible for retention one
-- full RETENTION_DAYS after this deploy rather than on the first nightly run. Backfilling
-- from created_at would have purged a thread answered last week because it was opened
-- last winter.
ALTER TABLE "prayer_requests" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
