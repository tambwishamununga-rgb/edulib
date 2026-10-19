-- Library features: book metadata, AI summaries, and reading/usage history for recommendations.
-- Run after 002_resources.sql.

ALTER TABLE resources
    ADD COLUMN IF NOT EXISTS author          TEXT,
    ADD COLUMN IF NOT EXISTS description     TEXT,                      -- written by the uploader
    ADD COLUMN IF NOT EXISTS summary         TEXT,                      -- extractive summary made by the AI service
    ADD COLUMN IF NOT EXISTS metadata_edited BOOLEAN NOT NULL DEFAULT FALSE;  -- true once the owner edits title/author by hand

-- Everything a student does with a resource. This is the data the recommender learns from.
CREATE TABLE IF NOT EXISTS interactions (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    action      TEXT NOT NULL CHECK (action IN ('view', 'download', 'upload')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_interactions_user_time ON interactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_resource  ON interactions (resource_id);

-- Search now covers the author and description too.
CREATE OR REPLACE FUNCTION resources_search_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '') || ' ' || coalesce(NEW.author, '')), 'A') ||
        setweight(to_tsvector('english', array_to_string(NEW.keywords, ' ')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.subject, '') || ' ' || coalesce(NEW.course_code, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(NEW.description, '') || ' ' || coalesce(NEW.summary, '')), 'D');
    NEW.updated_at := now();
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Rebuild the search column for rows that already exist.
UPDATE resources SET title = title;
