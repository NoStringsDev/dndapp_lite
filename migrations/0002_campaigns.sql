-- Campaign lifecycle support

CREATE TABLE IF NOT EXISTS campaigns (
  id                   TEXT PRIMARY KEY,
  slug                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  tagline              TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'parked', 'archived')),
  is_current           INTEGER NOT NULL DEFAULT 0,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  card_image_url       TEXT NOT NULL DEFAULT '',
  accent_key           TEXT NOT NULL DEFAULT '',
  default_start_time   TEXT NOT NULL DEFAULT '18:30',
  default_end_time     TEXT NOT NULL DEFAULT '22:00',
  default_location     TEXT NOT NULL DEFAULT '',
  attendance_mode      TEXT NOT NULL DEFAULT 'select_players' CHECK (attendance_mode IN ('full_party', 'select_players')),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

INSERT OR IGNORE INTO campaigns (
  id, slug, name, tagline, status, is_current, sort_order, card_image_url, accent_key,
  default_start_time, default_end_time, default_location, attendance_mode, created_at, updated_at
) VALUES
  (
    'camp_green_hunger', 'green_hunger', 'The Green Hunger', 'Main campaign', 'active', 1, 0,
    'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80&fit=crop&crop=center',
    'gh',
    '18:30', '22:00', 'Online / home', 'full_party', datetime('now'), datetime('now')
  ),
  (
    'camp_arcadia', 'arcadia', 'Arcadia', 'Also playing', 'active', 0, 1,
    'https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=800&q=80&fit=crop&crop=center',
    'arc',
    '18:30', '22:00', 'Arcadia Games, 46 Essex St, Temple, London WC2R 3JF', 'select_players', datetime('now'), datetime('now')
  );

ALTER TABLE bookings ADD COLUMN campaign_id TEXT;

UPDATE bookings
SET campaign_id = CASE
  WHEN kind = 'arcadia' THEN 'camp_arcadia'
  ELSE 'camp_green_hunger'
END
WHERE campaign_id IS NULL OR campaign_id = '';

CREATE INDEX IF NOT EXISTS idx_campaigns_status_current_sort
  ON campaigns(status, is_current, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_bookings_campaign_id ON bookings(campaign_id);
