-- Add fifth player "Tim" to the roster.
-- Safe to run on databases that already have Tim (INSERT OR IGNORE no-ops).
INSERT OR IGNORE INTO players (id, display_name, sort_order, is_active) VALUES
  ('tim', 'Tim', 4, 1);
