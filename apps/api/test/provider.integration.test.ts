import { newId } from '@paybox/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PaystackClient } from '../src/provider/client';
import { FakePaystackClient } from '../src/provider/fake';
import { HttpPaystackClient } from '../src/provider/http';
import { db, pool, resetDatabase, setupDatabase } from './database';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(() => pool.end());
const fake = new FakePaystackClient(db, 'http://localhost:4000', 'whsec_fixture');
function contract(name: string, getClient: () => PaystackClient) {
  describe(name, () => {
    it('initializes integer money and verifies the same transaction reference', async () => {
      const client = getClient();
      const reference = `contract-${newId()}`;
      const result = await client.initialize({
        email: 'contract@example.com',
        amount: 1500000,
        currency: 'NGN',
        reference,
        callback_url: 'http://localhost:3000',
        metadata: {},
      });
      expect(result.reference).toBe(reference);
      expect(result.authorization_url).toMatch(/^https?:\/\//);
      const transaction = await client.verify(reference);
      expect(transaction).toMatchObject({ reference, amount: 1500000, currency: 'NGN' });
    });
  });
}
contract('FakePaystackClient contract', () => fake);
if (process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_'))
  contract(
    'HttpPaystackClient test-mode contract',
    () => new HttpPaystackClient(process.env.PAYSTACK_SECRET_KEY!),
  );
it('fake faults persist across processes and refund references dedupe', async () => {
  await fake.initialize({
    email: 'test@example.com',
    amount: 10000,
    currency: 'NGN',
    reference: 'fake-contract',
    callback_url: 'http://localhost:3000',
    metadata: {},
  });
  await fake.settle('fake-contract');
  const input = {
    transaction: 'fake-contract',
    reference: 'rf_contract',
    amount: 100,
    currency: 'NGN' as const,
    merchant_note: 'Test',
  };
  const first = await fake.createRefund(input);
  const second = await fake.createRefund(input);
  expect(first.id).toBe(second.id);
  expect(fake.sign('{}')).toMatch(/^t=\d+,v1=whk_fake:[a-f0-9]{128}$/);
});
it('fake checkout and duplicate-only fault controls emit replayable signed events', async () => {
  const { fixture } = await import('./fixtures');
  const { webhookDeliveries } = await import('@paybox/db');
  const f = await fixture(db);
  const created = await f.service.create(f.merchant.id, 'checkout', {
    amount: 1500000,
    customer: { email: 'test@example.com' },
  });
  const reference = String(created.body.reference);
  expect((await f.app.request(`/fake/checkout/${reference}`)).status).toBe(200);
  expect((await f.app.request(`/fake/checkout/${reference}/succeed`, { method: 'POST' })).status).toBe(200);
  const response = await f.app.request('/fake/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference, duplicate: 3 }),
  });
  expect(response.status).toBe(200);
  expect(await db.select().from(webhookDeliveries)).toHaveLength(4);
});
