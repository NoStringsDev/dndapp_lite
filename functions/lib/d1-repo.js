/**
 * D1 repository adapter for dndapp_lite
 */

const SESSION_SCOPE_GROUP = 'group';
const SESSION_SCOPE_MAIN = 'main';

export class D1Repo {
  constructor(db) {
    this._db = db;
  }

  async listActivePlayers() {
    const res = await this._db
      .prepare('SELECT id, display_name, sort_order, is_active FROM players WHERE is_active = 1 ORDER BY sort_order ASC, display_name ASC')
      .all();
    return (res.results || []).map(r => ({
      id: r.id,
      displayName: r.display_name,
      sortOrder: r.sort_order,
      isActive: !!r.is_active,
    }));
  }

  async getPlayerById(id) {
    const row = await this._db
      .prepare('SELECT id, display_name, sort_order, is_active FROM players WHERE id = ?')
      .bind(id)
      .first();
    if (!row) return null;
    return {
      id: row.id,
      displayName: row.display_name,
      sortOrder: row.sort_order,
      isActive: !!row.is_active,
    };
  }

  async getVotesForPlayer(playerId) {
    const res = await this._db
      .prepare('SELECT date, vote FROM votes WHERE player_id = ?')
      .bind(playerId)
      .all();
    const map = {};
    (res.results || []).forEach(r => { map[r.date] = r.vote || ''; });
    return map;
  }

  async getAllVotesForDates(dates) {
    if (!dates.length) return {};
    const placeholders = dates.map(() => '?').join(',');
    const res = await this._db
      .prepare(`SELECT player_id, date, vote FROM votes WHERE date IN (${placeholders})`)
      .bind(...dates)
      .all();
    const out = {};
    (res.results || []).forEach(r => {
      if (!out[r.date]) out[r.date] = {};
      out[r.date][r.player_id] = r.vote || '';
    });
    return out;
  }

  async upsertVotes(playerId, rows) {
    const stmts = [];
    for (const row of rows) {
      stmts.push(
        this._db
          .prepare('INSERT OR REPLACE INTO votes (player_id, date, vote) VALUES (?, ?, ?)')
          .bind(playerId, row.date, row.vote)
      );
    }
    if (stmts.length) await this._db.batch(stmts);
  }

  async getBooking(date) {
    const row = await this._db
      .prepare(
        'SELECT date, kind, start_time, end_time, location, attendee_player_ids, created_at, created_by_player_id FROM bookings WHERE date = ?'
      )
      .bind(date)
      .first();
    if (!row) return null;
    return {
      date: row.date,
      kind: row.kind,
      startTime: row.start_time,
      endTime: row.end_time,
      location: row.location || '',
      attendeePlayerIds: row.attendee_player_ids
        ? row.attendee_player_ids.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      createdAt: row.created_at,
      createdByPlayerId: row.created_by_player_id || null,
    };
  }

  async listBookingsFrom(fromIsoDate) {
    const res = await this._db
      .prepare(
        'SELECT date, kind, start_time, end_time, location, attendee_player_ids, created_at, created_by_player_id FROM bookings WHERE date >= ? ORDER BY date ASC'
      )
      .bind(fromIsoDate)
      .all();
    return (res.results || []).map(row => ({
      date: row.date,
      kind: row.kind,
      startTime: row.start_time,
      endTime: row.end_time,
      location: row.location || '',
      attendeePlayerIds: row.attendee_player_ids
        ? row.attendee_player_ids.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      createdAt: row.created_at,
      createdByPlayerId: row.created_by_player_id || null,
    }));
  }

  async upsertBooking(row) {
    await this._db
      .prepare(
        'INSERT OR REPLACE INTO bookings (date, kind, start_time, end_time, location, attendee_player_ids, created_at, created_by_player_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        row.date,
        row.kind,
        row.startTime,
        row.endTime,
        row.location || '',
        (row.attendeePlayerIds || []).join(','),
        row.createdAt,
        row.createdByPlayerId || null
      )
      .run();
  }

  async deleteBooking(date) {
    await this._db.prepare('DELETE FROM bookings WHERE date = ?').bind(date).run();
  }

  async createSession(sessionId, playerId, expiresAtIso) {
    await this._db
      .prepare('INSERT INTO sessions (id, player_id, expires_at) VALUES (?, ?, ?)')
      .bind(sessionId, playerId, expiresAtIso)
      .run();
  }

  async deleteSession(sessionId) {
    await this._db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  }

  async deleteExpiredSessions(nowIso) {
    await this._db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso).run();
  }

  async getSession(sessionId) {
    const row = await this._db
      .prepare('SELECT id, player_id, expires_at FROM sessions WHERE id = ?')
      .bind(sessionId)
      .first();
    if (!row) return null;
    return { id: row.id, playerId: row.player_id, expiresAt: row.expires_at };
  }

  async getActiveCalendarFeedToken(scopeType, scopeId) {
    const row = await this._db
      .prepare(
        'SELECT token FROM calendar_feed_tokens WHERE scope_type = ? AND scope_id = ? AND is_active = 1 LIMIT 1'
      )
      .bind(scopeType, scopeId)
      .first();
    return row ? row.token : null;
  }

  async createCalendarFeedToken(token, scopeType, scopeId, createdAt) {
    await this._db
      .prepare(
        'INSERT INTO calendar_feed_tokens (token, scope_type, scope_id, is_active, created_at, rotated_at) VALUES (?, ?, ?, 1, ?, ?)'
      )
      .bind(token, scopeType, scopeId, createdAt, '')
      .run();
  }

  async deactivateCalendarFeedTokens(scopeType, scopeId, rotatedAt) {
    await this._db
      .prepare(
        'UPDATE calendar_feed_tokens SET is_active = 0, rotated_at = ? WHERE scope_type = ? AND scope_id = ? AND is_active = 1'
      )
      .bind(rotatedAt, scopeType, scopeId)
      .run();
  }

  async getCalendarFeedScopeByToken(token) {
    const row = await this._db
      .prepare('SELECT scope_type, scope_id FROM calendar_feed_tokens WHERE token = ? AND is_active = 1')
      .bind(token)
      .first();
    if (!row) return null;
    return { scopeType: row.scope_type, scopeId: row.scope_id };
  }

  /** @returns {{ type: string, id: string }} */
  get scopeGroup() {
    return { type: SESSION_SCOPE_GROUP, id: SESSION_SCOPE_MAIN };
  }
}
