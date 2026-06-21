CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" varchar PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

INSERT INTO "app_settings" ("key", "value")
VALUES ('ai_model', 'gpt-5.4')
ON CONFLICT ("key") DO NOTHING;
