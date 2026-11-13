import { outboxJobs, payments, webhookDeliveries, webhookEvents } from '@paybox/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { db, pool, resetDatabase, setupDatabase } from './database';
import { fixture } from './fixtures';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(() => pool.end());
it('five signed redeliveries create one durable event and one outbox job', async () => {
  const f = await fixture(db);
  const payload = {
    event: 'charge.success',
    data: { id: 42, reference: 'unknown', status: 'success', amount: 1500000 },
  };
  const durations: number[] = [];
  for (let i = 0; i < 20; i++) {
    const raw = JSON.stringify(payload, null, i % 2 ? 2 : undefined);
    const start = performance.now();
    const response = await f.app.request('/webhooks/paystack', {
      method: 'POST',
      headers: { 'Paystack-Signature': f.client.sign(raw) },
      body: raw,
    });
    durations.push(performance.now() - start);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  }
  expect(await db.select().from(webhookEvents)).toHaveLength(1);
  expect(await db.select().from(outboxJobs)).toHaveLength(1);
  expect(
    (await db.select().from(webhookDeliveries)).filter((row) => row.outcome === 'duplicate'),
  ).toHaveLength(19);
  expect(durations.sort((a, b) => a - b)[18]).toBeLessThan(100);
  expect(await db.select().from(payments)).toHaveLength(0);
});
it('bad signatures and oversized bodies are rejected before persistence', async () => {
  const f = await fixture(db);
  expect((await f.app.request('/webhooks/paystack', { method: 'POST', body: '{}' })).status).toBe(401);
  expect(
    (await f.app.request('/webhooks/paystack', { method: 'POST', body: 'x'.repeat(262145) })).status,
  ).toBe(413);
  expect(await db.select().from(webhookEvents)).toHaveLength(0);
});
it('unsupported events are retained as ignored without scheduling money changes', async () => {
  const f = await fixture(db);
  const raw = JSON.stringify({ event: 'charge.dispute.create', data: { id: 9, status: 'pending' } });
  expect(
    (
      await f.app.request('/webhooks/paystack', {
        method: 'POST',
        headers: { 'Paystack-Signature': f.client.sign(raw) },
        body: raw,
      })
    ).status,
  ).toBe(200);
  expect((await db.select().from(webhookEvents))[0]?.status).toBe('ignored');
  expect(await db.select().from(outboxJobs)).toHaveLength(0);
});
