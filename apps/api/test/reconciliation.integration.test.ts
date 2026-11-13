import { eq, fakeTransactions, journalEntries, payments, reconciliationChecks } from '@paybox/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Reconciliation } from '../src/reconciliation';
import { db, pool, resetDatabase, setupDatabase } from './database';
import { fixture, operatorFixture } from './fixtures';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(() => pool.end());
it('reconciliation auto-heals missing webhooks, flags amount drift and never adjusts it', async () => {
  const f = await fixture(db);
  const recon = new Reconciliation(db, f.client);
  const first = await f.service.create(f.merchant.id, 'one', {
    amount: 1500000,
    customer: { email: 'ada@example.com' },
  });
  const second = await f.service.create(f.merchant.id, 'two', {
    amount: 1500000,
    customer: { email: 'bisi@example.com' },
  });
  const a = await f.service.find(String(first.body.id)),
    b = await f.service.find(String(second.body.id));
  await f.client.settle(a.reference);
  await f.client.settle(b.reference);
  await db.update(fakeTransactions).set({ drift: -50000 }).where(eq(fakeTransactions.reference, b.reference));
  const run = await recon.start('ops@example.com');
  await recon.run(run.id);
  await recon.run(run.id);
  const report = await recon.detail(run.id);
  expect(report).toMatchObject({ status: 'completed', checked: 2, matched: 1, mismatched: 1 });
  expect(report.items.map((i) => [i.kind, i.resolution]).sort()).toEqual([
    ['amount_mismatch', 'open'],
    ['missing_webhook', 'auto_healed'],
  ]);
  expect((await f.service.find(a.id)).status).toBe('succeeded');
  expect((await f.service.find(b.id)).status).toBe('pending');
  expect(await db.select().from(journalEntries)).toHaveLength(1);
  expect(await db.select().from(reconciliationChecks)).toHaveLength(2);
  const ops = await operatorFixture(db, f.config);
  const mismatch = report.items.find((i) => i.kind === 'amount_mismatch')!;
  const resolved = await f.app.request(`/v1/admin/reconciliation/items/${mismatch.id}/resolve`, {
    method: 'POST',
    headers: ops.headers,
    body: JSON.stringify({ note: 'Confirmed test drift; no accounting adjustment.' }),
  });
  expect(resolved.status).toBe(200);
  expect((await f.service.find(b.id)).amount).toBe(1500000);
});
it('reconciliation detects ledger and status mismatches and deduplicates scheduled runs', async () => {
  const f = await fixture(db),
    recon = new Reconciliation(db, f.client);
  const created = await f.service.create(f.merchant.id, 'bad', {
    amount: 10000,
    customer: { email: 'ada@example.com' },
  });
  const payment = await f.service.find(String(created.body.id));
  await db.update(payments).set({ status: 'succeeded' }).where(eq(payments.id, payment.id));
  const runs = await Promise.all([
    recon.start('scheduler', 'same-day'),
    recon.start('scheduler', 'same-day'),
  ]);
  expect(runs[0]?.id).toBe(runs[1]?.id);
  await recon.run(runs[0]!.id);
  expect((await recon.detail(runs[0]!.id)).items.map((i) => i.kind).sort()).toEqual([
    'ledger_imbalance',
    'status_mismatch',
  ]);
});
