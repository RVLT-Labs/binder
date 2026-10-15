CREATE TABLE "export_records" (
	"id" text PRIMARY KEY NOT NULL,
	"show_id" text NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"cast_variant_id" text,
	"layer_selection" jsonb NOT NULL,
	"snapshot_id" text,
	"binder_version" integer,
	"private_to" text,
	"file_key" text NOT NULL,
	"changelog" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "export_records" ADD CONSTRAINT "export_records_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_records_show_idx" ON "export_records" USING btree ("show_id");