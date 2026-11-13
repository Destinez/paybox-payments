import { eq, fakeTransactions, journalEntries, payments, webhookEvents } from '@paybox/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { JobRunner } from '../src/jobs';
import { settlementHandlers, verifyPayment } from '../src/settlement';
import { db, pool, resetDatabase, setupDatabase } from './database';
import { fixture } from './fixtures';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(() => pool.end());
async function setup() {
  const f = await fixture(db);
  const result = await f.service.create(f.merchant.id, 'payment', {
    amount: 1500000,
    customer: { email: 'ada@example.com' },
  });
  const payment = await f.service.find(String(result.body.id));
  return { ...f, payment, runner: new JobRunner(db, settlementHandlers(db, f.client), true) };
}
it('replayed webhook is a no-op: five deliveries produce one state transition and one capture', async () => {
  const f = await setup();
  const raw = JSON.stringify(await f.client.settle(f.payment.reference));
  for (let i = 0; i < 5; i++)
    await f.app.request('/webhooks/paystack', {
      method: 'POST',
      headers: { 'Paystack-Signature': f.client.sign(raw) },
      body: raw,
    });
  await f.runner.tick();
  await f.runner.tick();
  expect((await f.service.find(f.payment.id)).status).toBe('succeeded');
  expect(await db.select().from(journalEntries)).toHaveLength(1);
  expect((await db.select().from(webhookEvents))[0]?.status).toBe('processed');
  await verifyPayment(db, f.client, f.payment.id);
  expect(await db.select().from(journalEntries)).toHaveLength(1);
});
it('webhook alone never marks paid when the verified amount differs', async () => {
  const f = await setup();
  const raw = JSON.stringify(await f.client.settle(f.payment.reference));
  await db.update(fakeTransactions).set({ drift: -50000 });
  await f.app.request('/webhooks/paystack', {
    method: 'POST',
    headers: { 'Paystack-Signature': f.client.sign(raw) },
    body: raw,
  });
  await f.runner.tick();
  await f.runner.tick();
  expect((await f.service.find(f.payment.id)).status).toBe('pending');
  expect(await db.select().from(journalEntries)).toHaveLength(0);
  expect((await db.select().from(webhookEvents))[0]?.status).toBe('failed');
});
it('late verified success can recover abandoned payments and posts merchant-paid fees exactly once', async () => {
  const f = await setup();
  await db.update(payments).set({ status: 'abandoned' }).where(eq(payments.id, f.payment.id));
  await db.update(fakeTransactions).set({ fees: 10000 });
  await f.client.settle(f.payment.reference);
  await Promise.all([verifyPayment(db, f.client, f.payment.id), verifyPayment(db, f.client, f.payment.id)]);
  expect((await f.service.find(f.payment.id)).status).toBe('succeeded');
  expect((await db.select().from(journalEntries)).map((row) => row.kind).sort()).toEqual(['capture', 'fee']);
});
