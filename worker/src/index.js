function allowedOrigin(origin)
{
  return origin == 'https://zaioiemeerkat-commits.github.io' ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
}

function corsHeaders(request)
{
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Length, X-Share-Read-Key, X-Share-Owner-Key',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  });
  const origin = request.headers.get('Origin') || '';
  if (allowedOrigin(origin))
    headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function jsonResponse(request, payload, status = 200)
{
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), {status, headers});
}

function errorResponse(request, message, status)
{
  return jsonResponse(request, {error: message}, status);
}

function validRoute(pathname, method)
{
  if (pathname == '/api/discovery')
    return method == 'GET';
  if (pathname == '/api/shares')
    return method == 'POST';
  return /^\/api\/shares\/[0-9a-f-]+(?:\/heartbeat)?$/i.test(pathname) &&
    ['GET', 'POST', 'DELETE'].includes(method);
}

export default {
  async fetch(request, env)
  {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if (!allowedOrigin(origin))
      return errorResponse(request, 'This site is not allowed to use the save relay.', 403);
    if (request.method == 'OPTIONS')
      return new Response(null, {status: 204, headers: corsHeaders(request)});
    if (!validRoute(url.pathname, request.method))
      return errorResponse(request, 'Not found.', 404);
    if (!env.RELAY_ORIGIN || !env.RELAY_SECRET)
      return errorResponse(request, 'The self-hosted save relay is not configured.', 503);

    const clientIp = request.headers.get('CF-Connecting-IP');
    if (!clientIp)
      return errorResponse(request, 'Client network address is unavailable.', 503);

    try {
      const {success: withinApiLimit} = await env.API_RATE_LIMITER.limit({key: clientIp});
      if (!withinApiLimit)
        return errorResponse(request, 'Too many save relay requests. Try again shortly.', 429);
      if (request.method == 'POST' && url.pathname == '/api/shares') {
        const {success: withinUploadLimit} = await env.UPLOAD_RATE_LIMITER.limit({key: clientIp});
        if (!withinUploadLimit)
          return errorResponse(request, 'Too many save uploads from this network. Try again shortly.', 429);
      }

      const target = new URL(url.pathname + url.search, env.RELAY_ORIGIN);
      const headers = new Headers(request.headers);
      headers.set('X-Relay-Secret', env.RELAY_SECRET);
      headers.set('X-Relay-Client-IP', clientIp);
      const body = request.method == 'GET' || request.method == 'HEAD' ? undefined : request.body;
      const upstreamRequest = new Request(target, {
        method: request.method,
        headers,
        body,
        duplex: body ? 'half' : undefined,
        redirect: 'manual'
      });
      const upstreamResponse = await fetch(upstreamRequest);
      const responseHeaders = corsHeaders(request);
      for (const name of ['Content-Type', 'Content-Length', 'Content-Disposition'])
        if (upstreamResponse.headers.has(name))
          responseHeaders.set(name, upstreamResponse.headers.get(name));
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: responseHeaders
      });
    } catch (error) {
      console.error('Save relay proxy request failed.', error);
      return errorResponse(request, 'The self-hosted save relay could not be reached.', 502);
    }
  }
};
