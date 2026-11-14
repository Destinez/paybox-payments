import type { NextRequest } from 'next/server';
export const dynamic = 'force-dynamic';
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (!['admin', 'session'].includes(path[0] ?? ''))
    return Response.json({ detail: 'Route not found' }, { status: 404 });
  const url = new URL(
    `/v1/${path.map(encodeURIComponent).join('/')}`,
    process.env.API_URL ?? 'http://localhost:4000',
  );
  url.search = request.nextUrl.search;
  const headers = new Headers();
  for (const key of ['cookie', 'content-type', 'x-csrf-token', 'idempotency-key']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set('Origin', request.nextUrl.origin);
  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const output = new Headers();
    for (const key of [
      'content-type',
      'set-cookie',
      'x-request-id',
      'x-correlation-id',
      'retry-after',
      'idempotent-replayed',
    ]) {
      const value = response.headers.get(key);
      if (value) output.set(key, value);
    }
    output.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers: output });
  } catch {
    return Response.json(
      { detail: 'The payments service is unavailable. Please retry shortly.' },
      { status: 503 },
    );
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
