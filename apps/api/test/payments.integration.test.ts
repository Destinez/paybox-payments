import { eq, idempotencyKeys, payments } from '@paybox/db';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { ProviderError } from '../src/provider/client';
import { db, pool, resetDatabase, setupDatabase } from './database';
import { fixture } from './fixtures';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(() => pool.end());
const body = { amount: 1500000, currency: 'NGN', customer: { email: 'ada@example.com' } };
it('20 concurrent identical requests create one payment and make one processor call', async () => {
  const f = await fixture(db);
  const initialize = vi.spyOn(f.client, 'initialize');
  const responses = await Promise.all(
    Array.from({ length: 20 }, () =>
      f.app.request('/v1/payments', {
        method: 'POST',
        headers: { ...f.headers, 'Idempotency-Key': 'concurrent' },
        body: JSON.stringify(body),
      }),
    ),
  );
  expect(responses.every((r) => [201, 409].includes(r.status))).toBe(true);
  expect(responses.filter((r) => r.status === 201).length).toBeGreaterThan(0);
  expect(await db.select().from(payments)).toHaveLength(1);
  expect(initialize).toHaveBeenCalledTimes(1);
  const replay = await f.app.request('/v1/payments', {
    method: 'POST',
    headers: { ...f.headers, 'Idempotency-Key': 'concurrent' },
    body: JSON.stringify(body),
  });
  expect(replay.status).toBe(201);
  expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
  const original = await responses.find((r) => r.status === 201)!.json();
  expect(await replay.json()).toEqual(original);
  const changed = await f.app.request('/v1/payments', {
    method: 'POST',
    headers: { ...f.headers, 'Idempotency-Key': 'concurrent' },
    body: JSON.stringify({ ...body, amount: 20 }),
  });
  expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({ code: 'idempotency_key_reuse' });
});
it('5xx responses release the idempotency lease without losing the payment recovery reference', async () => {
  const f = await fixture(db);
  vi.spyOn(f.client, 'initialize').mockRejectedValueOnce(new ProviderError('offline'));
  const request = () =>
    f.app.request('/v1/payments', {
      method: 'POST',
      headers: { ...f.headers, 'Idempotency-Key': 'retry' },
      body: JSON.stringify(body),
    });
  expect((await request()).status).toBe(502);
  expect((await request()).status).toBe(201);
  expect(await db.select().from(payments)).toHaveLength(1);
});
it('merchant isolation, reference uniqueness, filters and validation are enforced', async () => {
  const a = await fixture(db),
    b = await fixture(db);
  const response = await a.app.request('/v1/payments', {
    method: 'POST',
    headers: { ...a.headers, 'Idempotency-Key': 'one' },
    body: JSON.stringify({ ...body, reference: 'ORD-1042' }),
  });
  const payment = (await response.json()) as { id: string };
  expect(response.status).toBe(201);
  expect((await b.app.request(`/v1/payments/${payment.id}`, { headers: b.headers })).status).toBe(404);
  const list = await a.app.request('/v1/payments?q=ORD&status=pending&limit=1', { headers: a.headers });
  expect(((await list.json()) as { data: { customer: { email: string } }[] }).data[0]!.customer.email).toBe(
    'a***@example.com',
  );
  expect((await a.app.request('/v1/payments?limit=101', { headers: a.headers })).status).toBe(400);
  expect(
    (await a.app.request('/v1/payments', { method: 'POST', headers: a.headers, body: JSON.stringify(body) }))
      .status,
  ).toBe(400);
  expect((await a.app.request('/v1/payments', { headers: {} })).status).toBe(401);
  const duplicate = await a.app.request('/v1/payments', {
    method: 'POST',
    headers: { ...a.headers, 'Idempotency-Key': 'two' },
    body: JSON.stringify({ ...body, reference: 'ORD-1042' }),
  });
  expect(duplicate.status).toBe(409);
});
it('expired idempotency keys may be used again', async () => {
  const f = await fixture(db);
  const req = () =>
    f.app.request('/v1/payments', {
      method: 'POST',
      headers: { ...f.headers, 'Idempotency-Key': 'expiring' },
      body: JSON.stringify(body),
    });
  expect((await req()).status).toBe(201);
  await db
    .update(idempotencyKeys)
    .set({ expiresAt: new Date(0) })
    .where(eq(idempotencyKeys.key, 'expiring'));
  expect((await req()).status).toBe(201);
  expect(await db.select().from(payments)).toHaveLength(2);
});
