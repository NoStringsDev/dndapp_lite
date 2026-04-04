-- Dev seed: four players (re-run after migrate for local dev)
INSERT OR REPLACE INTO players (id, display_name, sort_order, is_active) VALUES
  ('chris', 'Chris', 0, 1),
  ('emil',  'Emil',  1, 1),
  ('jose',  'Jose',  2, 1),
  ('aidan', 'Aidan', 3, 1);
