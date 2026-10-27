CREATE TABLE "document_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"show_id" text NOT NULL,
	"user_id" text NOT NULL,
	"mode" text NOT NULL,
	"document_id" text,
	"kind" text,
	"title" text,
	"ocr_mode" text,
	"label" text,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"secret_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"staging_key" text NOT NULL,
	"result_document_id" text,
	"result_version_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_uploads" ADD CONSTRAINT "document_uploads_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_uploads_user_idx" ON "document_uploads" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "document_uploads_expires_idx" ON "document_uploads" USING btree ("expires_at");