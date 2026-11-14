import { apiKeys, eq, newId, outboxJobs, rateLimits, sql } from '@paybox/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { enqueue, JobRunner } from '../src/jobs';
import { consumeToken } from '../src/limits';
import { telemetry } from '../src/telemetry';
import { db, pool, resetDatabase, setupDatabase } from './database';
import { fixture } from './fixtures';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(() => pool.end());
it('Postgres token buckets serialize concurrent callers and API exhaustion returns Retry-After', async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, () => consumeToken(db, 'concurrent', 10, 900000)),
  );
  expect(results.filter((delay) => delay === 0)).toHaveLength(10);
  const f = await fixture(db);
  const [key] = await db.select().from(apiKeys);
  await db.insert(rateLimits).values({ id: `api:${key!.id}`, tokens: '0' });
  const denied = await f.app.request('/v1/payments', { headers: f.headers });
  expect(denied.status).toBe(429);
  expect(Number(denied.headers.get('Retry-After'))).toBeGreaterThan(0);
  await db.update(rateLimits).set({ updatedAt: new Date(Date.now() - 61000) });
  expect((await f.app.request('/v1/payments', { headers: f.headers })).status).toBe(200);
});
it('login throttling ignores spoofed forwarding headers and does not rate-limit signed webhooks', async () => {
  const f = await fixture(db);
  for (let i = 0; i < 10; i++) {
    const response = await f.app.request('/v1/session/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${i}` },
      body: JSON.stringify({ email: 'login@example.com', password: 'incorrect' }),
    });
    expect(response.status).toBe(401);
  }
  const response = await f.app.request('/v1/session/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'LOGIN@example.com', password: 'incorrect' }),
  });
  expect(response.status).toBe(429);
  expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect((await f.app.request('/webhooks/paystack', { method: 'POST', body: '{}' })).status).toBe(401);
});
it('request correlation survives idempotent replay and metrics use bounded route labels', async () => {
  const f = await fixture(db);
  const options = {
    method: 'POST',
    headers: { ...f.headers, 'Idempotency-Key': 'correlation' },
    body: JSON.stringify({ amount: 10000, customer: { email: 'ada@example.com' } }),
  };
  const first = await f.app.request('/v1/payments', options);
  const payment = JSON.parse(await first.text());
  expect(payment.correlation_id).toBe(first.headers.get('X-Request-Id'));
  expect(first.headers.get('X-Correlation-Id')).toBe(payment.correlation_id);
  const replay = await f.app.request('/v1/payments', options);
  expect(replay.headers.get('X-Request-Id')).not.toBe(first.headers.get('X-Request-Id'));
  expect(replay.headers.get('X-Correlation-Id')).toBe(payment.correlation_id);
  await f.app.request(`/unknown/${newId()}`);
  const metrics = await (await f.app.request('/metrics')).text();
  expect(metrics).toContain('idempotency_replays_total 1');
  expect(metrics).toContain('http_requests_total{route="/v1/payments",status="201"} 2');
  expect(metrics).toContain('route="unmatched"');
  expect(metrics).not.toContain(payment.id);
});
it('worker metrics remain visible to another process through durable attempt records', async () => {
  const job = await enqueue(db, 'test', null, {}, 'metrics');
  const runner = new JobRunner(db, { test: async () => {} });
  await runner.tick();
  const metrics = await telemetry(db).metrics();
  expect(metrics).toContain('outbox_jobs_total{type="test",outcome="succeeded"} 1');
  expect(metrics).toContain('outbox_job_latency_seconds_count 1');
  await db.update(outboxJobs).set({ status: 'dead' }).where(eq(outboxJobs.id, job!.id));
  expect(await telemetry(db).metrics()).toContain('outbox_dlq_depth 1');
});
it('readiness requires exact migration checksums while liveness stays independent', async () => {
  const f = await fixture(db);
  expect((await f.app.request('/readyz')).status).toBe(200);
  const migrations = await db.execute<{ id: number; hash: string }>(
    sql`SELECT id,hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1`,
  );
  const migration = migrations.rows[0]!;
  await db.execute(sql`UPDATE drizzle.__drizzle_migrations SET hash='wrong' WHERE id=${migration.id}`);
  try {
    expect((await f.app.request('/readyz')).status).toBe(503);
    expect((await f.app.request('/healthz')).status).toBe(200);
  } finally {
    await db.execute(
      sql`UPDATE drizzle.__drizzle_migrations SET hash=${migration.hash} WHERE id=${migration.id}`,
    );
  }
});
it('security headers and strict CORS are present on success and problem responses', async () => {
  const f = await fixture(db);
  const denied = await f.app.request('/v1/payments', { headers: { Origin: 'https://untrusted.example' } });
  expect(denied.status).toBe(401);
  expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  expect(denied.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(denied.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  const allowed = await f.app.request('/healthz', { headers: { Origin: f.config.WEB_URL } });
  expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(f.config.WEB_URL);
});
