-- The founder's own published posts on every platform, so routines read them with
-- one query instead of scrolling the profile. text is only what the founder wrote;
-- media_description is PostOrca's explanation of an image or video, never their voice.
CREATE TABLE social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  link_id uuid REFERENCES brand_profile_links(id) ON DELETE SET NULL,
  platform text NOT NULL,
  kind text NOT NULL,
  -- Nullable so drafts can live here later; every row is published for now.
  post_id text CHECK (char_length(post_id) <= 200),
  url text CHECK (char_length(url) <= 2048),
  text text,
  text_truncated boolean NOT NULL DEFAULT false,
  text_length int CHECK (text_length >= 0),
  title text CHECK (char_length(title) <= 500),
  media_type text NOT NULL DEFAULT 'none'
    CHECK (media_type IN ('none', 'image', 'video', 'carousel', 'link')),
  media_description text CHECK (char_length(media_description) <= 2000),
  reply_to_url text CHECK (char_length(reply_to_url) <= 2048),
  posted_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(stats) = 'object'),
  stats_checked_at timestamptz,
  source text NOT NULL CHECK (source IN ('sync', 'founder', 'agent')),
  -- The PostOrca draft it came from.
  artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (platform = 'X' AND kind IN ('post', 'reply', 'quote', 'repost', 'article'))
    OR (platform = 'Threads' AND kind IN ('post', 'reply', 'quote', 'repost'))
    OR (platform = 'Instagram' AND kind IN ('post', 'reel', 'story', 'carousel'))
    OR (platform = 'Facebook' AND kind IN ('post', 'reel', 'story'))
    OR (platform = 'LinkedIn' AND kind IN ('post', 'reply', 'article'))
  )
);

-- A platform's post IDs are unique on that platform, so keying by founder and
-- platform also matches a post saved before its account was known.
CREATE UNIQUE INDEX social_posts_post ON social_posts(user_id, platform, post_id)
  WHERE post_id IS NOT NULL;
CREATE INDEX social_posts_user_time ON social_posts(user_id, posted_at DESC);
CREATE INDEX social_posts_link_time ON social_posts(link_id, posted_at DESC)
  WHERE link_id IS NOT NULL;

-- When each account's posts were last read in full, so a sync reads only what's new
-- and routines know how fresh the table is.
ALTER TABLE brand_profile_links ADD COLUMN posts_synced_at timestamptz;
