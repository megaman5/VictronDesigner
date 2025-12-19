CREATE TABLE "ai_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar,
	"visitor_id" varchar,
	"user_id" varchar,
	"user_email" text,
	"ip" varchar,
	"action" varchar NOT NULL,
	"prompt" text NOT NULL,
	"system_voltage" integer DEFAULT 12 NOT NULL,
	"success" boolean NOT NULL,
	"duration_ms" integer NOT NULL,
	"iterations" integer,
	"quality_score" integer,
	"component_count" integer,
	"wire_count" integer,
	"error_message" text,
	"model" varchar,
	"response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar,
	"visitor_id" varchar,
	"user_id" varchar,
	"type" varchar NOT NULL,
	"endpoint" varchar,
	"message" text NOT NULL,
	"stack" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar,
	"visitor_id" varchar,
	"user_id" varchar,
	"type" varchar NOT NULL,
	"name" varchar NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text NOT NULL,
	"email" text,
	"user_agent" text NOT NULL,
	"state" jsonb NOT NULL,
	"screenshot" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schematics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"system_voltage" integer DEFAULT 12 NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wires" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" varchar NOT NULL,
	"user_id" varchar,
	"user_email" text,
	"user_agent" text NOT NULL,
	"ip" varchar NOT NULL,
	"page_views" integer DEFAULT 0 NOT NULL,
	"actions" integer DEFAULT 0 NOT NULL,
	"start_time" timestamp DEFAULT now() NOT NULL,
	"last_activity" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_designs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"system_voltage" integer DEFAULT 12 NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wires" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thumbnail" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text,
	"password" text,
	"google_id" text,
	"email" text,
	"display_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "schematics" ADD CONSTRAINT "schematics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_logs_created_at_idx" ON "ai_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_logs_visitor_id_idx" ON "ai_logs" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "error_logs_created_at_idx" ON "error_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "error_logs_type_idx" ON "error_logs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "events_created_at_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "sessions_visitor_id_idx" ON "sessions" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "sessions_start_time_idx" ON "sessions" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "user_designs_user_id_idx" ON "user_designs" USING btree ("user_id");