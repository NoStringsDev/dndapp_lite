-- Campaign theming tokens and mode

ALTER TABLE campaigns ADD COLUMN theme_mode TEXT NOT NULL DEFAULT 'auto' CHECK (theme_mode IN ('auto', 'manual'));
ALTER TABLE campaigns ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#7ab880';
ALTER TABLE campaigns ADD COLUMN accent_soft_color TEXT NOT NULL DEFAULT 'rgba(122,184,128,0.18)';
ALTER TABLE campaigns ADD COLUMN text_on_accent TEXT NOT NULL DEFAULT '#e8f8e8';
ALTER TABLE campaigns ADD COLUMN overlay_color TEXT NOT NULL DEFAULT 'rgba(0,0,0,0.70)';
ALTER TABLE campaigns ADD COLUMN border_color TEXT NOT NULL DEFAULT '#2e5030';
ALTER TABLE campaigns ADD COLUMN pill_color TEXT NOT NULL DEFAULT 'rgba(255,255,255,0.10)';

UPDATE campaigns
SET
  theme_mode = 'auto',
  accent_color = CASE WHEN slug = 'arcadia' THEN '#b8a8ff' ELSE '#7ab880' END,
  accent_soft_color = CASE WHEN slug = 'arcadia' THEN 'rgba(184,168,255,0.18)' ELSE 'rgba(122,184,128,0.18)' END,
  text_on_accent = CASE WHEN slug = 'arcadia' THEN '#e8e0ff' ELSE '#e8f8e8' END,
  overlay_color = CASE WHEN slug = 'arcadia' THEN 'rgba(24,18,48,0.62)' ELSE 'rgba(18,24,18,0.62)' END,
  border_color = CASE WHEN slug = 'arcadia' THEN '#4c4388' ELSE '#2e5030' END,
  pill_color = CASE WHEN slug = 'arcadia' THEN 'rgba(184,168,255,0.14)' ELSE 'rgba(122,184,128,0.14)' END
WHERE theme_mode IS NOT NULL;
