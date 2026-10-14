CREATE TABLE "annotations" (
	"id" text PRIMARY KEY NOT NULL,
	"show_id" text NOT NULL,
	"layer_kind" text NOT NULL,
	"layer_id" text NOT NULL,
	"anchor" jsonb NOT NULL,
	"type" text NOT NULL,
	"geometry" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotations_show_idx" ON "annotations" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "annotations_layer_idx" ON "annotations" USING btree ("layer_kind","layer_id");--> statement-breakpoint
CREATE INDEX "annotations_anchor_version_idx" ON "annotations" USING btree (("anchor"->>'documentVersionId'));