CREATE TABLE "cues" (
	"id" text PRIMARY KEY NOT NULL,
	"show_id" text NOT NULL,
	"department_id" text NOT NULL,
	"major" integer NOT NULL,
	"minor" integer DEFAULT 0 NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"anchor" jsonb,
	"type" text DEFAULT 'go' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"colour" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "cues_number_range" CHECK ("cues"."minor" between 0 and 99 and "cues"."major" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cues" ADD CONSTRAINT "cues_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cues" ADD CONSTRAINT "cues_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cues_show_idx" ON "cues" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "cues_department_idx" ON "cues" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "cues_anchor_version_idx" ON "cues" USING btree (("anchor"->>'documentVersionId'));