import { hash } from '@node-rs/argon2';
import { auditLog, dashboardUsers } from '@paybox/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { db, pool, resetDatabase, setupDatabase } from './database';
import { fixture, operatorFixture } from './fixtures';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(() => pool.end());
it('dashboard sessions use protected cookies, enforce CSRF and keep viewer access read-only', async () => {
  const f = await fixture(db);
  const password = 'test-password-fixture';
  await db
    .insert(dashboardUsers)
    .values({ email: 'viewer@example.com', passwordHash: await hash(password), role: 'viewer' });
  const login = await f.app.request('/v1/session/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'viewer@example.com', password }),
  });
  expect(login.status).toBe(200);
  expect(login.headers.get('set-cookie')).toMatch(/HttpOnly/);
  expect(login.headers.get('set-cookie')).toMatch(/SameSite=Lax/);
  const body = JSON.parse(await login.text());
  const headers = {
    Cookie: login.headers.get('set-cookie')!.split(';')[0]!,
    'X-CSRF-Token': body.csrf_token,
  };
  expect((await f.app.request('/v1/admin/summary', { headers })).status).toBe(200);
  expect((await f.app.request('/v1/admin/reconciliation/runs', { method: 'POST', headers })).status).toBe(
    403,
  );
  expect((await f.app.request('/v1/payments', { headers })).status).toBe(403);
  expect((await f.app.request('/v1/admin/users', { headers })).status).toBe(403);
  expect(
    (await f.app.request('/v1/session/logout', { method: 'POST', headers: { Cookie: headers.Cookie } }))
      .status,
  ).toBe(403);
  expect((await f.app.request('/v1/session/logout', { method: 'POST', headers })).status).toBe(200);
  expect((await f.app.request('/v1/session', { headers })).status).toBe(401);
});
it('administrators issue and revoke merchant keys; dashboard totals and timeline remain readable', async () => {
  const f = await fixture(db),
    admin = await operatorFixture(db, f.config, 'admin');
  const response = await f.app.request('/v1/admin/keys', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ merchant_id: f.merchant.id }),
  });
  expect(response.status).toBe(201);
  const issued = JSON.parse(await response.text());
  expect(
    (await f.app.request('/v1/payments', { headers: { Authorization: `Bearer ${issued.key}` } })).status,
  ).toBe(200);
  expect(
    (await f.app.request(`/v1/admin/keys/${issued.id}`, { method: 'DELETE', headers: admin.headers })).status,
  ).toBe(200);
  expect(
    (await f.app.request('/v1/payments', { headers: { Authorization: `Bearer ${issued.key}` } })).status,
  ).toBe(401);
  expect((await db.select().from(auditLog)).map((row) => row.action)).toContain('api_key.revoked');
  const created = await f.app.request('/v1/admin/payments', {
    method: 'POST',
    headers: { ...admin.headers, 'Idempotency-Key': 'dashboard' },
    body: JSON.stringify({
      merchant_id: f.merchant.id,
      amount: 1500000,
      customer: { email: 'ada@example.com' },
    }),
  });
  expect(created.status).toBe(201);
  const payment = JSON.parse(await created.text());
  const detail = await f.app.request(`/v1/admin/payments/${payment.id}`, { headers: admin.headers });
  expect(detail.status).toBe(200);
  expect(JSON.parse(await detail.text()).timeline).toHaveLength(2);
});
