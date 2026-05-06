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

function statusRank(status) {
  if (status === 'active') return 0;
  if (status === 'parked') return 1;
  return 2;
}

function sortCampaigns(campaigns) {
  return [...(campaigns || [])].sort((a, b) => {
    if (!!a.isCurrent !== !!b.isCurrent) return a.isCurrent ? -1 : 1;
    const rankDelta = statusRank(a.status) - statusRank(b.status);
    if (rankDelta !== 0) return rankDelta;
    const sortDelta = (a.sortOrder || 0) - (b.sortOrder || 0);
    if (sortDelta !== 0) return sortDelta;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function campaignLabel(campaign) {
  return campaign?.name || 'Unknown campaign';
}

function normaliseCampaignStatus(status) {
  if (status === 'parked' || status === 'archived') return status;
  return 'active';
}

function normaliseAttendanceMode(mode) {
  return mode === 'full_party' ? 'full_party' : 'select_players';
}

function campaignKindCompat(campaign) {
  return campaign?.slug || 'green_hunger';
}

function fallbackCampaignForBooking(booking) {
  if (booking?.kind === 'arcadia') {
    return {
      id: 'camp_arcadia',
      slug: 'arcadia',
      name: 'Arcadia',
      attendanceMode: 'select_players',
      defaultStartTime: '18:30',
      defaultEndTime: '22:00',
      defaultLocation: '',
    };
  }
  return {
    id: 'camp_green_hunger',
    slug: 'green_hunger',
    name: 'The Green Hunger',
    attendanceMode: 'full_party',
    defaultStartTime: '18:30',
    defaultEndTime: '22:00',
    defaultLocation: '',
  };
}

function normaliseTime(value, fallback) {
  const t = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(t) ? t : fallback;
}

function toConfirmedGames(bookings, nameById, campaignById) {
  return (bookings || []).map(b => {
    const campaign = campaignById[b.campaignId] || fallbackCampaignForBooking(b);
    const kind = campaignKindCompat(campaign);
    const startTime = normaliseTime(b.startTime, '18:30');
    const endTime = normaliseTime(b.endTime, '22:00');
    return {
      date: b.date,
      label: formatDateLabel(b.date),
      dayLabel: formatDayLabel(b.date),
      campaignId: b.campaignId || '',
      campaignName: campaignLabel(campaign),
      kind,
      kindLabel: campaignLabel(campaign),
      startTime,
      endTime,
      location: b.location || '',
      attendees: (b.attendeePlayerIds || []).map(id => ({ id, displayName: nameById[id] || id })),
      campaign: campaign || null,
      sessionTime: `${startTime}–${endTime}`,
    };
  });
}

export async function getPublicBootstrap(repo, env) {
  const players = await repo.listActivePlayers();
  const campaigns = sortCampaigns(await repo.listCampaigns());
  const requiresGroupSecret = Boolean(String(env?.GROUP_SECRET || '').trim());
  const today = isoDateInTimeZone(new Date(), TZ);
  const bookings = await repo.listBookingsFrom(today);
  const nameById = Object.fromEntries(players.map(p => [p.id, p.displayName]));
  const campaignById = Object.fromEntries(campaigns.map(c => [c.id, c]));
  const confirmedGames = toConfirmedGames(bookings, nameById, campaignById);
  return { ok: true, players, campaigns, requiresGroupSecret, confirmedGames };
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
  const players = await repo.listActivePlayers();
  const campaigns = sortCampaigns(await repo.listCampaigns());
  const dates = rollingDateIsos();
  const votesByDate = await repo.getAllVotesForDates(dates);
  const myVotes = await repo.getVotesForPlayer(playerId);

  const activeIds = players.map(p => p.id);
  const fullTableDates = [];
  for (const iso of dates) {
    const v = votesByDate[iso] || {};
    const ok = activeIds.every(id => (v[id] || '') === 'available');
    if (ok) fullTableDates.push(iso);
  }

  const today = isoDateInTimeZone(new Date(), TZ);
  const rangeStart = addDaysLondon(today, -ROLLING_PAST_DAYS);
  const bookings = await repo.listBookingsFrom(rangeStart);
  const nameById = Object.fromEntries(players.map(p => [p.id, p.displayName]));
  const me = await repo.getPlayerById(playerId);

  const campaignById = Object.fromEntries(campaigns.map(c => [c.id, c]));
  const confirmedGames = toConfirmedGames(bookings, nameById, campaignById);

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
    campaigns,
    dates: datesPayload,
    fullTableDates,
    confirmedGames,
    timezone: TZ,
    todayIso: today,
    defaultStart: '18:30',
    defaultEnd: '22:00',
  };
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
    const campaignId = String(payload?.campaignId || '').trim();
    const kind = String(payload?.kind || '').trim();
    let attendeeIds = Array.isArray(payload?.attendeePlayerIds) ? payload.attendeePlayerIds.map(String) : [];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Invalid date.' };

    const players = await repo.listActivePlayers();
    const activeIds = players.map(p => p.id);
    const campaigns = await repo.listCampaigns();
    const selected = campaigns.find(c => c.id === campaignId)
      || campaigns.find(c => c.slug === kind)
      || null;
    if (!selected) return { ok: false, error: 'Unknown campaign.' };
    if (selected.status !== 'active') return { ok: false, error: 'Only active campaigns can be booked.' };
    const startTime = normaliseTime(payload?.startTime, selected.defaultStartTime || '18:30');
    const endTime = normaliseTime(payload?.endTime, selected.defaultEndTime || '22:00');
    const location = String(payload?.location ?? '').trim() || String(selected.defaultLocation || '').trim();

    const existing = await repo.getBooking(date);
    const replaceExisting = Boolean(payload?.replaceExisting);
    if (existing && !replaceExisting) {
      return { ok: false, error: 'That date already has a confirmed session.' };
    }
    if (!existing && replaceExisting) {
      return { ok: false, error: 'No booking to update on that date.' };
    }

    if (selected.attendanceMode === 'full_party') {
      attendeeIds = [...activeIds];
    } else {
      attendeeIds = attendeeIds.filter(id => activeIds.includes(id));
      if (attendeeIds.length < 1) return { ok: false, error: 'Pick at least one player.' };
    }

    const createdAt = existing && replaceExisting ? existing.createdAt : new Date().toISOString();
    const createdByPlayerId =
      existing && replaceExisting ? (existing.createdByPlayerId || playerId) : playerId;

    await repo.upsertBooking({
      date,
      kind: selected.slug,
      campaignId: selected.id,
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

function slugifyCampaignName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'campaign';
}

function randomCampaignId() {
  return `camp_${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureCurrentCampaign(repo) {
  const campaigns = sortCampaigns(await repo.listCampaigns());
  const active = campaigns.filter(c => c.status === 'active');
  if (!active.length) return;
  if (active.some(c => c.isCurrent)) return;
  await repo.setCurrentCampaign(active[0].id);
}

export async function createCampaign(payload, repo) {
  try {
    const name = String(payload?.name || '').trim();
    if (!name) return { ok: false, error: 'Name is required.' };
    const status = normaliseCampaignStatus(payload?.status);
    const now = new Date().toISOString();
    const row = {
      id: randomCampaignId(),
      slug: slugifyCampaignName(payload?.slug || name),
      name,
      tagline: String(payload?.tagline || '').trim(),
      status,
      isCurrent: Boolean(payload?.isCurrent) && status === 'active',
      sortOrder: Number(payload?.sortOrder || 0) || 0,
      cardImageUrl: String(payload?.cardImageUrl || '').trim(),
      accentKey: String(payload?.accentKey || '').trim(),
      defaultStartTime: normaliseTime(payload?.defaultStartTime, '18:30'),
      defaultEndTime: normaliseTime(payload?.defaultEndTime, '22:00'),
      defaultLocation: String(payload?.defaultLocation || '').trim(),
      attendanceMode: normaliseAttendanceMode(payload?.attendanceMode),
      createdAt: now,
      updatedAt: now,
    };
    await repo.createCampaign(row);
    if (row.isCurrent) await repo.setCurrentCampaign(row.id);
    await ensureCurrentCampaign(repo);
    return { ok: true, ...(await buildAppPayload(repo, payload.playerId)) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function updateCampaign(payload, repo) {
  try {
    const id = String(payload?.id || '').trim();
    if (!id) return { ok: false, error: 'Campaign id is required.' };
    const existing = await repo.getCampaignById(id);
    if (!existing) return { ok: false, error: 'Campaign not found.' };
    const status = normaliseCampaignStatus(payload?.status ?? existing.status);
    const row = {
      ...existing,
      id,
      slug: slugifyCampaignName(payload?.slug || existing.slug || payload?.name || existing.name),
      name: String(payload?.name ?? existing.name).trim(),
      tagline: String(payload?.tagline ?? existing.tagline).trim(),
      status,
      sortOrder: Number(payload?.sortOrder ?? existing.sortOrder) || 0,
      cardImageUrl: String(payload?.cardImageUrl ?? existing.cardImageUrl).trim(),
      accentKey: String(payload?.accentKey ?? existing.accentKey).trim(),
      defaultStartTime: normaliseTime(payload?.defaultStartTime ?? existing.defaultStartTime, '18:30'),
      defaultEndTime: normaliseTime(payload?.defaultEndTime ?? existing.defaultEndTime, '22:00'),
      defaultLocation: String(payload?.defaultLocation ?? existing.defaultLocation).trim(),
      attendanceMode: normaliseAttendanceMode(payload?.attendanceMode ?? existing.attendanceMode),
      updatedAt: new Date().toISOString(),
    };
    await repo.updateCampaign(row);
    if (payload?.isCurrent && row.status === 'active') await repo.setCurrentCampaign(id);
    if (row.status !== 'active' && existing.isCurrent) {
      const next = (await repo.listBookableCampaigns())[0];
      if (next?.id) await repo.setCurrentCampaign(next.id);
    }
    await ensureCurrentCampaign(repo);
    return { ok: true, ...(await buildAppPayload(repo, payload.playerId)) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function setCurrentCampaign(payload, repo) {
  try {
    const id = String(payload?.id || '').trim();
    if (!id) return { ok: false, error: 'Campaign id is required.' };
    const campaign = await repo.getCampaignById(id);
    if (!campaign) return { ok: false, error: 'Campaign not found.' };
    if (campaign.status !== 'active') return { ok: false, error: 'Only active campaigns can be current.' };
    await repo.setCurrentCampaign(id);
    return { ok: true, ...(await buildAppPayload(repo, payload.playerId)) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function setCampaignStatus(payload, repo) {
  try {
    const id = String(payload?.id || '').trim();
    if (!id) return { ok: false, error: 'Campaign id is required.' };
    const status = normaliseCampaignStatus(payload?.status);
    const existing = await repo.getCampaignById(id);
    if (!existing) return { ok: false, error: 'Campaign not found.' };
    await repo.setCampaignStatus(id, status, new Date().toISOString());
    if (status !== 'active' && existing.isCurrent) await ensureCurrentCampaign(repo);
    if (status === 'active' && (payload?.makeCurrent || false)) await repo.setCurrentCampaign(id);
    await ensureCurrentCampaign(repo);
    return { ok: true, ...(await buildAppPayload(repo, payload.playerId)) };
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
  const campaignById = Object.fromEntries((await repo.listCampaigns()).map(c => [c.id, c]));
  const bookingDates = bookings.map(b => b.date);
  const myVotes = await repo.getVotesForPlayerOnDates(playerId, bookingDates);
  return bookings
    .filter(b => (myVotes[b.date] || '') === 'available' || (b.attendeePlayerIds || []).includes(playerId))
    .map(b => {
    const when = parseSessionTimes(b.date, b.startTime, b.endTime);
    const campaign = campaignById[b.campaignId] || fallbackCampaignForBooking(b);
    const summary = campaignLabel(campaign);
    const desc = [campaignLabel(campaign), b.location ? `Where: ${b.location}` : '']
      .filter(Boolean)
      .join('\\n');
    return {
      uid: `bk-${b.date}-${campaignKindCompat(campaign)}@${ICS_DOMAIN}`,
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
    const campaign = (b.campaignId && await repo.getCampaignById(b.campaignId)) || fallbackCampaignForBooking(b);
    const when = parseSessionTimes(b.date, b.startTime, b.endTime);
    const summary = campaignLabel(campaign);
    const events = [{
      uid: `single-${b.date}-${campaignKindCompat(campaign)}@${ICS_DOMAIN}`,
      startIso: when.startIso,
      endIso: when.endIso,
      summary,
      description: campaignLabel(campaign),
      location: b.location || '',
    }];
    return { ok: true, ics: buildIcsCalendar(events, summary) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
