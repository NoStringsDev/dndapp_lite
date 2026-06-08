/**
 * Idempotent D1 schema repair for production databases created before campaign migrations.
 * Runs once per isolate; safe to call on every API / calendar request.
 */

let schemaReady = false;

async function tableExists(db, name) {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(name)
    .first();
  return !!row;
}

async function columnExists(db, table, column) {
  const res = await db.prepare(`PRAGMA table_info(${table})`).all();
  return (res.results || []).some(r => r.name === column);
}

async function exec(db, sql) {
  await db.prepare(sql).run();
}

const CAMPAIGNS_DDL = `
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
  theme_mode           TEXT NOT NULL DEFAULT 'auto' CHECK (theme_mode IN ('auto', 'manual')),
  accent_color         TEXT NOT NULL DEFAULT '#7ab880',
  accent_soft_color    TEXT NOT NULL DEFAULT 'rgba(122,184,128,0.18)',
  text_on_accent       TEXT NOT NULL DEFAULT '#e8f8e8',
  overlay_color        TEXT NOT NULL DEFAULT 'rgba(0,0,0,0.70)',
  border_color         TEXT NOT NULL DEFAULT '#2e5030',
  pill_color           TEXT NOT NULL DEFAULT 'rgba(255,255,255,0.10)',
  default_start_time   TEXT NOT NULL DEFAULT '18:30',
  default_end_time     TEXT NOT NULL DEFAULT '22:00',
  default_location     TEXT NOT NULL DEFAULT '',
  attendance_mode      TEXT NOT NULL DEFAULT 'select_players' CHECK (attendance_mode IN ('full_party', 'select_players')),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
`;

const THEME_COLUMNS = [
  ["theme_mode", "TEXT NOT NULL DEFAULT 'auto' CHECK (theme_mode IN ('auto', 'manual'))"],
  ["accent_color", "TEXT NOT NULL DEFAULT '#7ab880'"],
  ["accent_soft_color", "TEXT NOT NULL DEFAULT 'rgba(122,184,128,0.18)'"],
  ["text_on_accent", "TEXT NOT NULL DEFAULT '#e8f8e8'"],
  ["overlay_color", "TEXT NOT NULL DEFAULT 'rgba(0,0,0,0.70)'"],
  ["border_color", "TEXT NOT NULL DEFAULT '#2e5030'"],
  ["pill_color", "TEXT NOT NULL DEFAULT 'rgba(255,255,255,0.10)'"],
];

async function seedCampaigns(db) {
  await exec(
    db,
    `INSERT OR IGNORE INTO campaigns (
      id, slug, name, tagline, status, is_current, sort_order, card_image_url, accent_key,
      theme_mode, accent_color, accent_soft_color, text_on_accent, overlay_color, border_color, pill_color,
      default_start_time, default_end_time, default_location, attendance_mode, created_at, updated_at
    ) VALUES
      (
        'camp_green_hunger', 'green_hunger', 'The Green Hunger', 'Main campaign', 'active', 1, 0,
        'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80&fit=crop&crop=center',
        'gh', 'auto', '#7ab880', 'rgba(122,184,128,0.18)', '#e8f8e8', 'rgba(18,24,18,0.62)', '#2e5030', 'rgba(122,184,128,0.14)',
        '18:30', '22:00', 'Online / home', 'full_party', datetime('now'), datetime('now')
      ),
      (
        'camp_arcadia', 'arcadia', 'Arcadia', 'Also playing', 'active', 0, 1,
        'https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=800&q=80&fit=crop&crop=center',
        'arc', 'auto', '#b8a8ff', 'rgba(184,168,255,0.18)', '#e8e0ff', 'rgba(24,18,48,0.62)', '#4c4388', 'rgba(184,168,255,0.14)',
        '18:30', '22:00', 'Arcadia Games, 46 Essex St, Temple, London WC2R 3JF', 'select_players', datetime('now'), datetime('now')
      )`
  );
}

async function applyThemeDefaults(db) {
  await exec(
    db,
    `UPDATE campaigns SET
      theme_mode = COALESCE(NULLIF(theme_mode, ''), 'auto'),
      accent_color = CASE WHEN slug = 'arcadia' THEN '#b8a8ff' ELSE '#7ab880' END,
      accent_soft_color = CASE WHEN slug = 'arcadia' THEN 'rgba(184,168,255,0.18)' ELSE 'rgba(122,184,128,0.18)' END,
      text_on_accent = CASE WHEN slug = 'arcadia' THEN '#e8e0ff' ELSE '#e8f8e8' END,
      overlay_color = CASE WHEN slug = 'arcadia' THEN 'rgba(24,18,48,0.62)' ELSE 'rgba(18,24,18,0.62)' END,
      border_color = CASE WHEN slug = 'arcadia' THEN '#4c4388' ELSE '#2e5030' END,
      pill_color = CASE WHEN slug = 'arcadia' THEN 'rgba(184,168,255,0.14)' ELSE 'rgba(122,184,128,0.14)' END
    WHERE accent_color IS NULL OR accent_color = '' OR theme_mode IS NULL OR theme_mode = ''`
  );
}

const LEGACY_BOOKINGS_KIND_CHECK = "CHECK (kind IN ('green_hunger', 'arcadia'))";

async function bookingsHasLegacyKindCheck(db) {
  if (!(await tableExists(db, 'bookings'))) return false;
  const row = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bookings'")
    .first();
  const ddl = String(row?.sql || '');
  return ddl.includes(LEGACY_BOOKINGS_KIND_CHECK);
}

async function relaxBookingsKindCheck(db) {
  if (!(await tableExists(db, 'bookings'))) return false;
  if (!(await bookingsHasLegacyKindCheck(db))) return false;

  await exec(db, 'PRAGMA foreign_keys = OFF');
  await exec(
    db,
    `CREATE TABLE bookings_new (
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
    )`
  );
  const hasCampaignId = await columnExists(db, 'bookings', 'campaign_id');
  if (hasCampaignId) {
    await exec(
      db,
      `INSERT INTO bookings_new (
        date, kind, campaign_id, start_time, end_time, location,
        attendee_player_ids, created_at, created_by_player_id
      )
      SELECT
        date, kind, campaign_id, start_time, end_time, location,
        attendee_player_ids, created_at, created_by_player_id
      FROM bookings`
    );
  } else {
    await exec(
      db,
      `INSERT INTO bookings_new (
        date, kind, start_time, end_time, location,
        attendee_player_ids, created_at, created_by_player_id
      )
      SELECT
        date, kind, start_time, end_time, location,
        attendee_player_ids, created_at, created_by_player_id
      FROM bookings`
    );
  }
  await exec(db, 'DROP TABLE bookings');
  await exec(db, 'ALTER TABLE bookings_new RENAME TO bookings');
  await exec(db, 'CREATE INDEX IF NOT EXISTS idx_bookings_campaign_id ON bookings(campaign_id)');
  await exec(db, 'PRAGMA foreign_keys = ON');
  return true;
}

async function ensureBookingsCampaignId(db) {
  if (!(await tableExists(db, 'bookings'))) return;
  if (!(await columnExists(db, 'bookings', 'campaign_id'))) {
    await exec(db, 'ALTER TABLE bookings ADD COLUMN campaign_id TEXT');
  }
  if (await tableExists(db, 'campaigns')) {
    await exec(
      db,
      `UPDATE bookings
       SET campaign_id = (
         SELECT id FROM campaigns WHERE slug = bookings.kind LIMIT 1
       )
       WHERE (campaign_id IS NULL OR campaign_id = '')
         AND EXISTS (SELECT 1 FROM campaigns WHERE slug = bookings.kind)`
    );
    await exec(
      db,
      `UPDATE bookings SET campaign_id = CASE
        WHEN kind = 'arcadia' THEN 'camp_arcadia'
        ELSE 'camp_green_hunger'
      END
      WHERE campaign_id IS NULL OR campaign_id = ''`
    );
  }
  await exec(db, 'CREATE INDEX IF NOT EXISTS idx_bookings_campaign_id ON bookings(campaign_id)');
}

async function ensureTimPlayer(db) {
  if (!(await tableExists(db, 'players'))) return;
  await exec(
    db,
    `INSERT OR IGNORE INTO players (id, display_name, sort_order, is_active) VALUES ('tim', 'Tim', 4, 1)`
  );
}

/**
 * @returns {Promise<{ repaired: boolean, steps: string[] }>}
 */
export async function ensureSchema(db) {
  if (schemaReady) return { repaired: false, steps: [] };
  if (!db) return { repaired: false, steps: ['no_db_binding'] };

  const steps = [];

  try {
    if (!(await tableExists(db, 'campaigns'))) {
      await exec(db, CAMPAIGNS_DDL);
      steps.push('created_campaigns');
      await seedCampaigns(db);
      steps.push('seeded_campaigns');
    } else {
      for (const [name, ddl] of THEME_COLUMNS) {
        if (!(await columnExists(db, 'campaigns', name))) {
          await exec(db, `ALTER TABLE campaigns ADD COLUMN ${name} ${ddl}`);
          steps.push(`added_${name}`);
        }
      }
      await seedCampaigns(db);
      await applyThemeDefaults(db);
    }

    await exec(
      db,
      'CREATE INDEX IF NOT EXISTS idx_campaigns_status_current_sort ON campaigns(status, is_current, sort_order, name)'
    );
    if (await relaxBookingsKindCheck(db)) {
      steps.push('relaxed_bookings_kind_check');
    }
    await ensureBookingsCampaignId(db);
    if (steps.length === 0 || steps.includes('created_campaigns') || steps.includes('relaxed_bookings_kind_check')) {
      steps.push('bookings_campaign_id');
    }
    await ensureTimPlayer(db);

    schemaReady = true;
    return { repaired: steps.length > 0, steps };
  } catch (err) {
    schemaReady = false;
    throw err;
  }
}

/** Reset cache (tests only). */
export function _resetSchemaCacheForTests() {
  schemaReady = false;
}
