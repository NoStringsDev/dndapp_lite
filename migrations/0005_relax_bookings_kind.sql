-- Remove legacy bookings.kind CHECK so user-created campaign slugs can be stored.

PRAGMA foreign_keys = OFF;

CREATE TABLE bookings_new (
  date                 TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL,
  campaign_id          TEXT,
  start_time           TEXT NOT NULL,
  end_time             TEXT NOT NULL,
  location             TEXT NOT NULL DEFAULT '',
  attendee_player_ids  TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL,
  created_by_player_id TEXT,
  FOREIGN KEY (created_by_player_id) REFERENCES players(id)
);

INSERT INTO bookings_new (
  date, kind, campaign_id, start_time, end_time, location,
  attendee_player_ids, created_at, created_by_player_id
)
SELECT
  date, kind, campaign_id, start_time, end_time, location,
  attendee_player_ids, created_at, created_by_player_id
FROM bookings;

DROP TABLE bookings;

ALTER TABLE bookings_new RENAME TO bookings;

CREATE INDEX IF NOT EXISTS idx_bookings_campaign_id ON bookings(campaign_id);

PRAGMA foreign_keys = ON;
