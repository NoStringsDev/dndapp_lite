-- Optional local fixture mirroring production gate state (Drakkenheim + one booking).
-- Apply to the dev-server D1 sqlite after migrations — see AGENTS.md D1 gotcha.
UPDATE campaigns SET is_current = 0;
INSERT OR REPLACE INTO campaigns (
  id, slug, name, tagline, status, is_current, sort_order, card_image_url, accent_key,
  default_start_time, default_end_time, default_location, attendance_mode, created_at, updated_at
) VALUES (
  'camp_cih9tlxx', 'drakkenheim', 'Drakkenheim', '', 'active', 1, 0,
  'https://media.dndbeyond.com/compendium-images/dodr/ui/drakkenheim-cover-art.jpg',
  '',
  '18:30', '22:00', '', 'select_players', datetime('now'), datetime('now')
);
INSERT OR REPLACE INTO bookings (
  date, kind, campaign_id, start_time, end_time, location,
  attendee_player_ids, created_at, created_by_player_id
) VALUES (
  '2026-06-25', 'drakkenheim', 'camp_cih9tlxx', '18:30', '22:00', '',
  'aidan,chris,emil,jose,tim', datetime('now'), 'chris'
);
