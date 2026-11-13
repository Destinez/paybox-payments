import { eq, fakeRefunds, journalEntries, outboxJobs, refunds } from '@paybox/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Refunds } from '../src/refunds';
import { verifyPayment } from '../src/settlement';
import { db, pool, resetDatabase, setupDatabase } from './database';
import { fixture } from './fixtures';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(() => pool.end());
async function setup() {
  const f = await fixture(db);
  const result = await f.service.create(f.merchant.id, 'pay', {
    amount: 1500000,
    customer: { email: 'ada@example.com' },
  });
  const payment = await f.service.find(String(result.body.id));
  await f.client.settle(payment.reference);
  await verifyPayment(db, f.client, payment.id);
  return { ...f, payment, refundService: new Refunds(db, f.client) };
}
it('ten concurrent refunds never reserve more than the paid amount', async () => {
  const f = await setup();
  const responses = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      f.app.request(`/v1/payments/${f.payment.id}/refunds`, {
        method: 'POST',
        headers: { ...f.headers, 'Idempotency-Key': `refund-${i}` },
        body: JSON.stringify({ amount: 500000 }),
      }),
    ),
  );
  expect(responses.filter((r) => r.status === 202)).toHaveLength(3);
  expect(responses.filter((r) => r.status === 422)).toHaveLength(7);
  expect((await db.select().from(refunds)).reduce((n, r) => n + r.amount, 0)).toBe(1500000);
  expect((await db.select().from(outboxJobs)).filter((j) => j.type === 'create_refund')).toHaveLength(3);
});
it('partial refunds reserve and settle once, and omitted amount refunds the remaining principal', async () => {
  const f = await setup();
  const first = await f.refundService.request(
    f.merchant.id,
    f.payment.id,
    'partial',
    { amount: 500000 },
    'ops@example.com',
  );
  await expect(f.refundService.process(String(first.body.id))).rejects.toMatchObject({ retryable: true });
  expect((await db.select().from(journalEntries)).map((j) => j.kind)).toContain('refund_reserved');
  await db.update(fakeRefunds).set({ status: 'processed' });
  await f.refundService.process(String(first.body.id));
  await f.refundService.process(String(first.body.id));
  expect((await f.service.find(f.payment.id)).status).toBe('partially_refunded');
  const rest = await f.refundService.request(f.merchant.id, f.payment.id, 'rest', {}, 'ops@example.com');
  expect(rest.body.amount).toBe(1000000);
  await expect(f.refundService.process(String(rest.body.id))).rejects.toMatchObject({ retryable: true });
  await db.update(fakeRefunds).set({ status: 'processed' });
  await f.refundService.process(String(rest.body.id));
  expect(await f.service.find(f.payment.id)).toMatchObject({ status: 'refunded', refundedAmount: 1500000 });
  expect((await db.select().from(journalEntries)).filter((j) => j.kind === 'refund_settled')).toHaveLength(2);
});
it('failed refunds release reserved funds and can be replaced safely', async () => {
  const f = await setup();
  const first = await f.refundService.request(
    f.merchant.id,
    f.payment.id,
    'failed',
    { amount: 1500000 },
    'ops@example.com',
  );
  await expect(f.refundService.process(String(first.body.id))).rejects.toMatchObject({ retryable: true });
  await db.update(fakeRefunds).set({ status: 'failed' });
  await f.refundService.process(String(first.body.id));
  expect(
    (
      await db
        .select()
        .from(refunds)
        .where(eq(refunds.id, String(first.body.id)))
    )[0]?.status,
  ).toBe('failed');
  expect((await db.select().from(journalEntries)).some((j) => j.kind === 'refund_released')).toBe(true);
  const replacement = await f.refundService.request(
    f.merchant.id,
    f.payment.id,
    'replacement',
    {},
    'ops@example.com',
  );
  expect(replacement.body.amount).toBe(1500000);
});
