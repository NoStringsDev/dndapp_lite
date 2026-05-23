/**
 * GET /image-proxy?url=https://...
 * Proxies remote artwork so client-side canvas sampling can read pixels.
 */
export async function onRequestGet(ctx) {
  try {
    const reqUrl = new URL(ctx.request.url);
    const raw = String(reqUrl.searchParams.get('url') || '').trim();
    if (!raw) {
      return new Response('Missing url param', { status: 400, headers: corsHeaders() });
    }
    let target;
    try {
      target = new URL(raw);
    } catch {
      return new Response('Invalid url', { status: 400, headers: corsHeaders() });
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      return new Response('Unsupported protocol', { status: 400, headers: corsHeaders() });
    }

    const upstream = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'dndapp-lite-theme-proxy/1.0',
      },
    });
    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, { status: 502, headers: corsHeaders() });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders(),
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    return new Response(String(err), { status: 500, headers: corsHeaders() });
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}
