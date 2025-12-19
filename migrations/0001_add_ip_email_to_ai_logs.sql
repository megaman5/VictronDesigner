-- Add ip and userEmail columns to ai_logs table for session association
ALTER TABLE "ai_logs" ADD COLUMN IF NOT EXISTS "user_email" text;
ALTER TABLE "ai_logs" ADD COLUMN IF NOT EXISTS "ip" varchar;
