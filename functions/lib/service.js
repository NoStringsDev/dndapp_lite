/**
 * dndapp_lite — business logic (platform-agnostic)
 */

import { generateSessionId } from './auth.js';

const TZ = 'Europe/London';
const ROLLING_DAYS = 84; // 12 weeks ahead
const ROLLING_PAST_DAYS = 84; // 12 weeks back — votes/bookings stay in D1; UI includes this window
const SESSION_TTL_HOURS = 24 * 14; // 14 days

const ICS_PRODID = '-//dndapp_lite//Calendar//EN';
const ICS_DOMAIN = 'dndapp-lite.local';

export function formatDateLabel(iso) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(iso + 'T12:00:00Z');
  return d.getUTCDate() + ' ' + months[d.getUTCMonth()];
}

export function formatDayLabel(iso) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date(iso + 'T12:00:00Z').getUTCDay()];
}

function isoDateInTimeZone(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function addDaysLondon(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + n);
  return isoDateInTimeZone(dt, TZ);
}

/** Calendar day range in Europe/London: past ROLLING_PAST_DAYS through future ROLLING_DAYS-1 from today */
export function rollingDateIsos() {
  const today = isoDateInTimeZone(new Date(), TZ);
  const out = [];
  for (let i = -ROLLING_PAST_DAYS; i < ROLLING_DAYS; i++) {
    out.push(addDaysLondon(today, i));
  }
  return out;
}

function icsEscape(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatIcsUtcStamp(date) {
  const iso = (date instanceof Date ? date : new Date(date)).toISOString();
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function formatIcsFloating(dateIsoTime) {
  return String(dateIsoTime || '').replace(/[-:]/g, '').slice(0, 15);
}

export function buildIcsCalendar(events, calendarName) {
  const dtStamp = formatIcsUtcStamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(calendarName || 'Party sessions')}`,
    'METHOD:PUBLISH',
  ];
  for (const e of events || []) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${icsEscape(e.uid)}`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART:${formatIcsFloating(e.startIso)}`);
    lines.push(`DTEND:${formatIcsFloating(e.endIso)}`);
    lines.push(`SUMMARY:${icsEscape(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function parseSessionTimes(dateIso, startHHMM, endHHMM) {
  const s = String(startHHMM || '18:30').trim();
  const e = String(endHHMM || '22:00').trim();
  return {
    startIso: `${dateIso}T${s}:00`,
    endIso: `${dateIso}T${e}:00`,
  };
}

function createCalendarToken() {
  const rand = crypto.getRandomValues(new Uint8Array(18));
  const body = btoa(String.fromCharCode(...rand)).replace(/[+/=]/g, '').slice(0, 24);
  return `grp_${body}`;
}

export function calendarUrlForToken(origin, token) {
  const base = String(origin || '').replace(/\/+$/, '');
  if (!base) return `/calendar/${encodeURIComponent(token)}.ics`;
  return `${base}/calendar/${encodeURIComponent(token)}.ics`;
}

function webcalUrlFromHttp(url) {
  return String(url || '').replace(/^https?:\/\//, 'webcal://');
}

async function ensureFeedToken(repo, playerId) {
  const sc = repo.scopePlayer(playerId);
  if (!sc.id) throw new Error('Missing player scope for feed token.');
  let existing = await repo.getActiveCalendarFeedToken(sc.type, sc.id);
  if (existing) return existing;
  const token = createCalendarToken();
  await repo.createCalendarFeedToken(token, sc.type, sc.id, new Date().toISOString());
  return token;
}

async function rotateFeedToken(repo, playerId) {
  const sc = repo.scopePlayer(playerId);
  if (!sc.id) throw new Error('Missing player scope for feed token.');
  await repo.deactivateCalendarFeedTokens(sc.type, sc.id, new Date().toISOString());
  const token = createCalendarToken();
  await repo.createCalendarFeedToken(token, sc.type, sc.id, new Date().toISOString());
  return token;
}

function kindLabel(kind) {
  if (kind === 'arcadia') return 'Arcadia session';
  return 'The Green Hunger';
}

function normaliseSessionKind(kind) {
  return kind === 'arcadia' ? 'arcadia' : 'green_hunger';
}

function normaliseTime(value, fallback) {
  const t = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(t) ? t : fallback;
}

function slugifyPlayerId(name) {
  const base = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base;
}

async function uniquePlayerId(repo, baseId) {
  let candidate = baseId || 'player';
  let suffix = 1;
  while (await repo.getPlayerById(candidate)) {
    suffix += 1;
    candidate = `${baseId || 'player'}-${suffix}`.slice(0, 40);
  }
  return candidate;
}

function normaliseDisplayName(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, 40);
}

const MAX_PLAYERS = 50;

function toConfirmedGames(bookings, nameById) {
  return (bookings || []).map(b => {
    const kind = normaliseSessionKind(b.kind);
    const startTime = normaliseTime(b.startTime, '18:30');
    const endTime = normaliseTime(b.endTime, '22:00');
    return {
      date: b.date,
      label: formatDateLabel(b.date),
      dayLabel: formatDayLabel(b.date),
      kind,
      kindLabel: kindLabel(kind),
      startTime,
      endTime,
      location: b.location || '',
      attendees: (b.attendeePlayerIds || []).map(id => ({ id, displayName: nameById[id] || id })),
      sessionTime: `${startTime}–${endTime}`,
    };
  });
}

export async function getPublicBootstrap(repo, env) {
  const players = await repo.listActivePlayers();
  const requiresGroupSecret = Boolean(String(env?.GROUP_SECRET || '').trim());
  const today = isoDateInTimeZone(new Date(), TZ);
  const bookings = await repo.listBookingsFrom(today);
  const nameById = Object.fromEntries(players.map(p => [p.id, p.displayName]));
  const confirmedGames = toConfirmedGames(bookings, nameById);
  return { ok: true, players, requiresGroupSecret, confirmedGames };
}

export async function login(payload, env, repo) {
  const secret = String(payload?.groupSecret || '').trim();
  const playerId = String(payload?.playerId || '').trim();
  const expected = String(env.GROUP_SECRET || '').trim();
  if (expected && secret !== expected) return { ok: false, error: 'Invalid group secret.' };
  if (!playerId) return { ok: false, error: 'Pick a player.' };
  const player = await repo.getPlayerById(playerId);
  if (!player || !player.isActive) return { ok: false, error: 'Unknown player.' };

  await repo.deleteExpiredSessions(new Date().toISOString());
  const sessionId = generateSessionId();
  const exp = new Date(Date.now() + SESSION_TTL_HOURS * 3600000).toISOString();
  await repo.createSession(sessionId, playerId, exp);

  return {
    ok: true,
    sessionId,
    me: { id: player.id, displayName: player.displayName },
  };
}

export async function logout(sessionId, repo) {
  if (sessionId) await repo.deleteSession(sessionId);
  return { ok: true };
}

export async function authMe(sessionId, repo) {
  if (!sessionId) return { ok: false, error: 'No session.' };
  await repo.deleteExpiredSessions(new Date().toISOString());
  const s = await repo.getSession(sessionId);
  if (!s) return { ok: false, error: 'Session expired.' };
  const exp = new Date(s.expiresAt).getTime();
  if (exp < Date.now()) {
    await repo.deleteSession(sessionId);
    return { ok: false, error: 'Session expired.' };
  }
  const player = await repo.getPlayerById(s.playerId);
  if (!player) return { ok: false, error: 'Player missing.' };
  return { ok: true, me: { id: player.id, displayName: player.displayName } };
}

async function buildAppPayload(repo, playerId) {
  const allPlayers = await repo.listAllPlayers();
  const players = allPlayers.filter(p => p.isActive);
  const dates = rollingDateIsos();
  const votesByDate = await repo.getAllVotesForDates(dates);
  const myVotes = await repo.getVotesForPlayer(playerId);

  const activeIds = players.map(p => p.id);
  const fullTableDates = [];
  for (const iso of dates) {
    const v = votesByDate[iso] || {};
    const ok = activeIds.length > 0 && activeIds.every(id => (v[id] || '') === 'available');
    if (ok) fullTableDates.push(iso);
  }

  const today = isoDateInTimeZone(new Date(), TZ);
  const rangeStart = addDaysLondon(today, -ROLLING_PAST_DAYS);
  const bookings = await repo.listBookingsFrom(rangeStart);
  const nameById = Object.fromEntries(allPlayers.map(p => [p.id, p.displayName]));
  const me = await repo.getPlayerById(playerId);

  const confirmedGames = toConfirmedGames(bookings, nameById);

  const datesPayload = dates.map(iso => ({
    iso,
    label: formatDateLabel(iso),
    dayLabel: formatDayLabel(iso),
    votes: votesByDate[iso] || {},
    fullTableOk: fullTableDates.includes(iso),
    myVote: myVotes[iso] || '',
  }));

  return {
    me: me ? { id: me.id, displayName: me.displayName } : null,
    players,
    allPlayers,
    dates: datesPayload,
    fullTableDates,
    confirmedGames,
    timezone: TZ,
    todayIso: today,
    defaultStart: '18:30',
    defaultEnd: '22:00',
    arcadiaDefaultLocation: 'Arcadia Games, 46 Essex St, Temple, London WC2R 3JF',
  };
}

export async function addPlayer(payload, repo) {
  try {
    const actorId = String(payload?.playerId || '').trim();
    if (!actorId) return { ok: false, error: 'Not authenticated.' };
    const displayName = normaliseDisplayName(payload?.displayName);
    if (!displayName) return { ok: false, error: 'Enter a player name.' };
    if (displayName.length < 1) return { ok: false, error: 'Name is too short.' };

    const allPlayers = await repo.listAllPlayers();
    if (allPlayers.length >= MAX_PLAYERS) {
      return { ok: false, error: `Roster is full (max ${MAX_PLAYERS}).` };
    }
    const nameTakenBy = allPlayers.find(
      p => p.displayName.toLowerCase() === displayName.toLowerCase()
    );
    if (nameTakenBy) {
      if (!nameTakenBy.isActive) {
        return {
          ok: false,
          error: `A player named "${nameTakenBy.displayName}" exists but is deactivated. Reactivate them instead.`,
        };
      }
      return { ok: false, error: 'A player with that name already exists.' };
    }

    const baseId = slugifyPlayerId(displayName) || 'player';
    const id = await uniquePlayerId(repo, baseId);
    const maxSo = await repo.getMaxPlayerSortOrder();
    const sortOrder = Number.isFinite(maxSo) ? maxSo + 1 : 0;
    await repo.createPlayer({ id, displayName, sortOrder, isActive: true });

    const data = await buildAppPayload(repo, actorId);
    return { ok: true, addedPlayer: { id, displayName }, ...data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function renamePlayer(payload, repo) {
  try {
    const actorId = String(payload?.playerId || '').trim();
    if (!actorId) return { ok: false, error: 'Not authenticated.' };
    const targetId = String(payload?.id || '').trim();
    const displayName = normaliseDisplayName(payload?.displayName);
    if (!targetId) return { ok: false, error: 'Missing player id.' };
    if (!displayName) return { ok: false, error: 'Enter a player name.' };

    const target = await repo.getPlayerById(targetId);
    if (!target) return { ok: false, error: 'Unknown player.' };
    if (target.displayName === displayName) {
      const data = await buildAppPayload(repo, actorId);
      return { ok: true, ...data };
    }

    const allPlayers = await repo.listAllPlayers();
    const clash = allPlayers.find(
      p => p.id !== targetId && p.displayName.toLowerCase() === displayName.toLowerCase()
    );
    if (clash) return { ok: false, error: 'Another player already uses that name.' };

    await repo.updatePlayer(targetId, { displayName });
    const data = await buildAppPayload(repo, actorId);
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function setPlayerActive(payload, repo) {
  try {
    const actorId = String(payload?.playerId || '').trim();
    if (!actorId) return { ok: false, error: 'Not authenticated.' };
    const targetId = String(payload?.id || '').trim();
    const isActive = !!payload?.isActive;
    if (!targetId) return { ok: false, error: 'Missing player id.' };

    const target = await repo.getPlayerById(targetId);
    if (!target) return { ok: false, error: 'Unknown player.' };

    if (!isActive) {
      if (targetId === actorId) {
        return { ok: false, error: 'You cannot deactivate yourself while signed in.' };
      }
      const activeCount = (await repo.listActivePlayers()).length;
      if (target.isActive && activeCount <= 1) {
        return { ok: false, error: 'At least one player must remain active.' };
      }
    }

    if (target.isActive === isActive) {
      const data = await buildAppPayload(repo, actorId);
      return { ok: true, ...data };
    }

    const patch = { isActive };
    if (isActive) {
      const maxSo = await repo.getMaxPlayerSortOrder();
      patch.sortOrder = Number.isFinite(maxSo) ? maxSo + 1 : 0;
    }
    await repo.updatePlayer(targetId, patch);

    const data = await buildAppPayload(repo, actorId);
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getAppData(payload, repo) {
  try {
    const playerId = String(payload?.playerId || '').trim();
    if (!playerId) return { ok: false, error: 'Not authenticated.' };
    const p = await repo.getPlayerById(playerId);
    if (!p) return { ok: false, error: 'Unknown player.' };
    const data = await buildAppPayload(repo, playerId);
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function saveVotes(payload, repo) {
  try {
    const playerId = String(payload?.playerId || '').trim();
    const votes = payload?.votes;
    if (!playerId) return { ok: false, error: 'Not authenticated.' };
    const player = await repo.getPlayerById(playerId);
    if (!player) return { ok: false, error: 'Unknown player.' };
    if (!Array.isArray(votes)) return { ok: false, error: 'votes must be an array.' };

    const rows = [];
    for (const v of votes) {
      const date = String(v?.date || '').trim();
      const vote = String(v?.vote || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!['available', 'maybe', 'unavailable', ''].includes(vote)) continue;
      rows.push({ date, vote });
    }
    await repo.upsertVotes(playerId, rows);
    const data = await buildAppPayload(repo, playerId);
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function confirmSession(payload, repo) {
  try {
    const playerId = String(payload?.playerId || '').trim();
    if (!playerId) return { ok: false, error: 'Not authenticated.' };
    const date = String(payload?.date || '').trim();
    const kind = String(payload?.kind || '').trim();
    const startTime = String(payload?.startTime || '18:30').trim();
    const endTime = String(payload?.endTime || '22:00').trim();
    const location = String(payload?.location ?? '').trim();
    let attendeeIds = Array.isArray(payload?.attendeePlayerIds) ? payload.attendeePlayerIds.map(String) : [];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Invalid date.' };
    if (kind !== 'green_hunger' && kind !== 'arcadia') return { ok: false, error: 'Invalid session kind.' };

    const players = await repo.listActivePlayers();
    const activeIds = players.map(p => p.id);

    const existing = await repo.getBooking(date);
    const replaceExisting = Boolean(payload?.replaceExisting);
    if (existing && !replaceExisting) {
      return { ok: false, error: 'That date already has a confirmed session.' };
    }
    if (!existing && replaceExisting) {
      return { ok: false, error: 'No booking to update on that date.' };
    }

    if (kind === 'green_hunger') {
      attendeeIds = [...activeIds];
    } else {
      attendeeIds = attendeeIds.filter(id => activeIds.includes(id));
      if (attendeeIds.length < 1) return { ok: false, error: 'Pick at least one player for Arcadia.' };
    }

    const createdAt = existing && replaceExisting ? existing.createdAt : new Date().toISOString();
    const createdByPlayerId =
      existing && replaceExisting ? (existing.createdByPlayerId || playerId) : playerId;

    await repo.upsertBooking({
      date,
      kind,
      startTime,
      endTime,
      location,
      attendeePlayerIds: attendeeIds,
      createdAt,
      createdByPlayerId,
    });

    const data = await buildAppPayload(repo, playerId);
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function unconfirmSession(payload, repo) {
  try {
    const playerId = String(payload?.playerId || '').trim();
    if (!playerId) return { ok: false, error: 'Not authenticated.' };
    const date = String(payload?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Invalid date.' };
    const existing = await repo.getBooking(date);
    if (!existing) return { ok: false, error: 'No booking on that date.' };
    await repo.deleteBooking(date);
    const data = await buildAppPayload(repo, playerId);
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getCalendarFeedLinks(payload, repo) {
  try {
    const origin = String(payload?.origin || '').trim();
    const playerId = String(payload?.playerId || '').trim();
    if (!playerId) return { ok: false, error: 'Not authenticated.' };
    const token = await ensureFeedToken(repo, playerId);
    const url = calendarUrlForToken(origin, token);
    return {
      ok: true,
      token,
      url,
      webcalUrl: webcalUrlFromHttp(url),
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function rotateCalendarFeedToken(payload, repo) {
  try {
    const origin = String(payload?.origin || '').trim();
    const playerId = String(payload?.playerId || '').trim();
    if (!playerId) return { ok: false, error: 'Not authenticated.' };
    const token = await rotateFeedToken(repo, playerId);
    const url = calendarUrlForToken(origin, token);
    return {
      ok: true,
      token,
      url,
      webcalUrl: webcalUrlFromHttp(url),
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function buildPlayerFeedEvents(repo, playerId) {
  const today = isoDateInTimeZone(new Date(), TZ);
  const bookings = await repo.listBookingsFrom(today);
  const bookingDates = bookings.map(b => b.date);
  const myVotes = await repo.getVotesForPlayerOnDates(playerId, bookingDates);
  return bookings
    .filter(b => (myVotes[b.date] || '') === 'available' || (b.attendeePlayerIds || []).includes(playerId))
    .map(b => {
    const when = parseSessionTimes(b.date, b.startTime, b.endTime);
    const summary = kindLabel(b.kind);
    const desc = [kindLabel(b.kind), b.location ? `Where: ${b.location}` : '']
      .filter(Boolean)
      .join('\\n');
    return {
      uid: `bk-${b.date}-${b.kind}@${ICS_DOMAIN}`,
      startIso: when.startIso,
      endIso: when.endIso,
      summary,
      description: desc,
      location: b.location || '',
    };
    });
}

export async function getCalendarFeedIcsByToken(token, repo) {
  try {
    const row = await repo.getCalendarFeedScopeByToken(String(token || '').trim());
    if (!row) return { ok: false, error: 'not found' };
    if (row.scopeType !== 'player' || !row.scopeId) return { ok: false, error: 'unsupported' };
    const events = await buildPlayerFeedEvents(repo, row.scopeId);
    const ics = buildIcsCalendar(events, 'Paralleleers Sessions');
    return { ok: true, ics };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getSingleEventCalendarIcs(payload, repo) {
  try {
    const date = String(payload?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Invalid date.' };
    const b = await repo.getBooking(date);
    if (!b) return { ok: false, error: 'No booking on that date.' };
    const when = parseSessionTimes(b.date, b.startTime, b.endTime);
    const summary = kindLabel(b.kind);
    const events = [{
      uid: `single-${b.date}-${b.kind}@${ICS_DOMAIN}`,
      startIso: when.startIso,
      endIso: when.endIso,
      summary,
      description: kindLabel(b.kind),
      location: b.location || '',
    }];
    return { ok: true, ics: buildIcsCalendar(events, summary) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
