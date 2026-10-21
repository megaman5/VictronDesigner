-- Additive; legacy rows remain readable with version 1 and a null document.
BEGIN;
ALTER TABLE user_designs ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE user_designs ADD COLUMN IF NOT EXISTS document jsonb;
ALTER TABLE user_designs ADD COLUMN IF NOT EXISTS create_request_id text;
CREATE UNIQUE INDEX IF NOT EXISTS user_designs_create_request_idx ON user_designs(user_id, create_request_id);
CREATE TABLE IF NOT EXISTS design_revisions (
 id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
 design_id varchar NOT NULL REFERENCES user_designs(id) ON DELETE CASCADE,
 user_id varchar NOT NULL, version integer NOT NULL, request_id text NOT NULL,
 source text NOT NULL DEFAULT 'manual', snapshot jsonb NOT NULL,
 created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS design_revisions_version_idx ON design_revisions(design_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS design_revisions_request_idx ON design_revisions(design_id, request_id);
CREATE INDEX IF NOT EXISTS design_revisions_owner_idx ON design_revisions(user_id, design_id);
INSERT INTO design_revisions(design_id,user_id,version,request_id,source,snapshot)
 SELECT id,user_id,version,'initial-' || id,'initial',to_jsonb(user_designs) FROM user_designs
 ON CONFLICT DO NOTHING;
COMMIT;
