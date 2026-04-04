-- dndapp_lite — single-party scheduling schema

CREATE TABLE IF NOT EXISTS players (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS votes (
  player_id TEXT NOT NULL,
  date      TEXT NOT NULL,
  vote      TEXT NOT NULL DEFAULT '' CHECK (vote IN ('available', 'maybe', 'unavailable', '')),
  PRIMARY KEY (player_id, date),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_votes_date ON votes(date);

CREATE TABLE IF NOT EXISTS bookings (
  date                 TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL CHECK (kind IN ('green_hunger', 'arcadia')),
  start_time           TEXT NOT NULL,
  end_time             TEXT NOT NULL,
  location             TEXT NOT NULL DEFAULT '',
  attendee_player_ids  TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL,
  created_by_player_id TEXT,
  FOREIGN KEY (created_by_player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
  token       TEXT PRIMARY KEY,
  scope_type  TEXT NOT NULL DEFAULT 'group',
  scope_id    TEXT NOT NULL DEFAULT 'main',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  rotated_at  TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_cal_feed_scope
  ON calendar_feed_tokens(scope_type, scope_id, is_active);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Default roster (edit via SQL if you add players later)
INSERT OR IGNORE INTO players (id, display_name, sort_order, is_active) VALUES
  ('chris', 'Chris', 0, 1),
  ('emil',  'Emil',  1, 1),
  ('jose',  'Jose',  2, 1),
  ('aidan', 'Aidan', 3, 1);
