/**
 * Cloudflare Pages Function — POST /api
 */

import { D1Repo } from './lib/d1-repo.js';
import * as svc from './lib/service.js';

const SESSION_COOKIE = 'dndlite_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 days (matches service TTL)

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  try {
    const body = await request.json();
    const action = body.action || '';
    const payload = body.payload ?? null;

    const repo = new D1Repo(env.DB);
    const actor = await resolveActor(request, repo);
    const result = await route(action, payload, actor, env, repo, request);

    const headers = { 'Content-Type': 'application/json', ...corsHeaders() };
    let setCookie = null;
    if (result && result._setCookie !== undefined) {
      setCookie = result._setCookie;
      delete result._setCookie;
    }
    if (setCookie !== null) headers['Set-Cookie'] = setCookie;

    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function parseCookie(header, name) {
  const parts = String(header || '').split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=') || '');
  }
  return null;
}

async function resolveActor(request, repo) {
  const sid = parseCookie(request.headers.get('Cookie') || '', SESSION_COOKIE);
  if (!sid) return null;
  await repo.deleteExpiredSessions(new Date().toISOString());
  const s = await repo.getSession(sid);
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) {
    await repo.deleteSession(sid);
    return null;
  }
  return { sessionId: sid, playerId: s.playerId };
}

function requireAuth(actor, fn) {
  if (!actor || !actor.playerId) return { ok: false, error: 'Unauthorised' };
  return fn();
}

function cookieSecureSuffix(request) {
  try {
    const u = new URL(request.url);
    return u.protocol === 'https:' ? '; Secure' : '';
  } catch {
    return '; Secure';
  }
}

async function route(action, payload, actor, env, repo, request) {
  switch (action) {
    case 'getPublicBootstrap':
      return svc.getPublicBootstrap(repo, env);

    case 'login': {
      const result = await svc.login(payload, env, repo);
      if (!result.ok) return result;
      const { sessionId, ...rest } = result;
      const sec = cookieSecureSuffix(request);
      const cookie = `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/${sec}; Max-Age=${SESSION_MAX_AGE}`;
      return { ...rest, _setCookie: cookie };
    }

    case 'logout': {
      const sid = actor?.sessionId || null;
      const result = await svc.logout(sid, repo);
      const sec = cookieSecureSuffix(request);
      const clear = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/${sec}; Max-Age=0`;
      return { ...result, _setCookie: clear };
    }

    case 'authMe':
      return svc.authMe(actor?.sessionId || null, repo);

    case 'getAppData':
      return requireAuth(actor, () => svc.getAppData({ playerId: actor.playerId }, repo));

    case 'saveVotes':
      return requireAuth(actor, () =>
        svc.saveVotes({ ...payload, playerId: actor.playerId }, repo)
      );

    case 'confirmSession':
      return requireAuth(actor, () =>
        svc.confirmSession({ ...payload, playerId: actor.playerId }, repo)
      );

    case 'createCampaign':
      return requireAuth(actor, () =>
        svc.createCampaign({ ...payload, playerId: actor.playerId }, repo)
      );

    case 'updateCampaign':
      return requireAuth(actor, () =>
        svc.updateCampaign({ ...payload, playerId: actor.playerId }, repo)
      );

    case 'setCurrentCampaign':
      return requireAuth(actor, () =>
        svc.setCurrentCampaign({ ...payload, playerId: actor.playerId }, repo)
      );

    case 'setCampaignStatus':
      return requireAuth(actor, () =>
        svc.setCampaignStatus({ ...payload, playerId: actor.playerId }, repo)
      );

    case 'unconfirmSession':
      return requireAuth(actor, () =>
        svc.unconfirmSession({ ...payload, playerId: actor.playerId }, repo)
      );

    case 'getCalendarFeedLinks':
      return requireAuth(actor, () =>
        svc.getCalendarFeedLinks({ ...payload, playerId: actor.playerId }, repo)
      );

    case 'rotateCalendarFeedToken':
      return requireAuth(actor, () =>
        svc.rotateCalendarFeedToken({ ...payload, playerId: actor.playerId }, repo)
      );

    case 'getSingleEventCalendarIcs':
      return svc.getSingleEventCalendarIcs(payload, repo);

    default:
      return { ok: false, error: `Unknown action: ${action}` };
  }
}
