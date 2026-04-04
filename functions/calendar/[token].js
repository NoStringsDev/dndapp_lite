import { D1Repo } from '../lib/d1-repo.js';
import { getCalendarFeedIcsByToken } from '../lib/service.js';

export async function onRequestGet(ctx) {
  try {
    const repo = new D1Repo(ctx.env.DB);
    const tokenRaw = String(ctx.params?.token || '').trim();
    const token = tokenRaw.endsWith('.ics') ? tokenRaw.slice(0, -4) : tokenRaw;
    const result = await getCalendarFeedIcsByToken(token, repo);
    if (!result.ok) {
      return new Response('Calendar feed not found.', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response(result.ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch {
    return new Response('Calendar feed unavailable.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
