export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const response = await fetch(
      new URL('/v1/openapi.json', process.env.API_URL ?? 'http://localhost:4000'),
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      },
    );
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json({ detail: 'Start the payments API to view its OpenAPI schema.' }, { status: 503 });
  }
}
