-- Social drafts as their own artifact kinds, stored as JSON in content
-- (schemas/social.ts): a reply to someone's post, and (next) a post of the
-- founder's own. They mirror social_posts' platform + kind, so a draft and the
-- post it becomes share one shape.
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_kind_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_kind_check CHECK (kind IN
  ('document', 'screenshot', 'image', 'audio', 'video', 'url', 'idea', 'reply', 'post'));

-- What the founder did with a reply: posted it (done) or passed on it (skipped).
ALTER TABLE artifacts ADD COLUMN state text CHECK (state IN ('done', 'skipped'));
ALTER TABLE artifacts ADD COLUMN state_at timestamptz;
