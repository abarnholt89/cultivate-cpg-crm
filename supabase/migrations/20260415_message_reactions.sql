CREATE TABLE IF NOT EXISTS message_reactions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid        NOT NULL REFERENCES brand_retailer_messages(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction   text        NOT NULL DEFAULT 'thumbs_up',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, reaction)
);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- Users can insert/delete their own reactions
CREATE POLICY "Users manage own reactions"
  ON message_reactions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Everyone authenticated can read reaction counts
CREATE POLICY "Authenticated users read all reactions"
  ON message_reactions FOR SELECT TO authenticated
  USING (true);
