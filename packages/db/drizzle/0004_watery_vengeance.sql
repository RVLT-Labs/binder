CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"show_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"colour" text NOT NULL,
	"number_format" text DEFAULT 'decimal' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "departments_show_code_unique" UNIQUE("show_id","code")
);
--> statement-breakpoint
ALTER TABLE "change_log" ADD COLUMN "layer" text;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "departments_show_idx" ON "departments" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "change_log_show_row_seq_idx" ON "change_log" USING btree ("show_id","row_id","seq");