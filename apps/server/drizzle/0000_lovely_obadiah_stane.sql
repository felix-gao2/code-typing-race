CREATE TABLE "races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"started_with" integer NOT NULL,
	"snippet_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"player_name" text NOT NULL,
	"snippet_id" integer NOT NULL,
	"race_id" uuid,
	"wpm" real NOT NULL,
	"accuracy" real NOT NULL,
	"errors" integer NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"ranked" boolean NOT NULL,
	"engine_version" integer NOT NULL,
	"engine_mode" text NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snippets" (
	"id" serial PRIMARY KEY NOT NULL,
	"generator_version" integer NOT NULL,
	"language" text NOT NULL,
	"lines" integer NOT NULL,
	"seed" integer NOT NULL,
	CONSTRAINT "snippets_identity" UNIQUE("generator_version","language","lines","seed")
);
--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_snippet_id_snippets_id_fk" FOREIGN KEY ("snippet_id") REFERENCES "public"."snippets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_snippet_id_snippets_id_fk" FOREIGN KEY ("snippet_id") REFERENCES "public"."snippets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;