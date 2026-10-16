ALTER TABLE "document_versions" ADD COLUMN "original_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "failure_dpi" integer;--> statement-breakpoint
UPDATE "document_versions" SET "failure_code" = CASE
  WHEN "error" LIKE '%password-protected%' THEN 'password_protected'
  WHEN "error" LIKE 'This file could not be read%' THEN 'unreadable'
  WHEN "error" LIKE '%timed out%' THEN 'timeout'
  WHEN "error" = 'Could not queue processing' THEN 'enqueue_failed'
  ELSE 'unknown'
END
WHERE "status" = 'failed' AND "failure_code" IS NULL;
