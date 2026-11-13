import {
  auditLog,
  clearing,
  eq,
  journalEntries,
  ledgerAccounts,
  ledgerLines,
  merchants,
  newId,
  payable,
  paymentEvents,
  payments,
  postEntry,
  sql,
} from '@paybox/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { db, pool, resetDatabase, setupDatabase } from './database';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(() => pool.end());
async function fixture() {
  const [merchant] = await db.insert(merchants).values({ name: 'Lagos merchant' }).returning();
  if (!merchant) throw new Error('fixture');
  const [payment] = await db
    .insert(payments)
    .values({
      merchantId: merchant.id,
      reference: 'test-payment',
      amount: 1500000,
      customerEmail: 'ada@example.com',
      correlationId: newId(),
    })
    .returning();
  if (!payment) throw new Error('fixture');
  return { merchant, payment };
}
it('ledger postings are balanced, exactly once, and append-only', async () => {
  const { merchant, payment } = await fixture();
  const input = {
    kind: 'capture',
    paymentId: payment.id,
    idempotencyRef: `pay:${payment.id}:captured`,
    lines: [clearing('debit', payment.amount), payable(merchant.id, 'credit', payment.amount)],
  };
  const ids = await Promise.all(
    Array.from({ length: 5 }, () => db.transaction((tx) => postEntry(tx, input))),
  );
  expect(new Set(ids).size).toBe(1);
  expect(await db.select().from(ledgerLines)).toHaveLength(2);
  await expect(db.update(ledgerLines).set({ amount: 1 })).rejects.toThrow();
  await expect(db.delete(ledgerLines)).rejects.toThrow();
  await expect(db.delete(journalEntries)).rejects.toThrow();
  const net = await db.execute<{ net: string }>(
    sql`SELECT sum(CASE WHEN direction='debit' THEN amount ELSE -amount END)::text AS net FROM ledger_lines`,
  );
  expect(net.rows[0]?.net).toBe('0');
});
it('deferred database constraints reject empty or unbalanced journals', async () => {
  const { payment } = await fixture();
  await expect(
    db.insert(journalEntries).values({ kind: 'invalid', paymentId: payment.id, idempotencyRef: 'empty' }),
  ).rejects.toThrow();
  await expect(
    db.transaction(async (tx) => {
      const [account] = await tx.insert(ledgerAccounts).values({ code: 'bad', type: 'asset' }).returning();
      const [entry] = await tx
        .insert(journalEntries)
        .values({ kind: 'invalid', idempotencyRef: 'bad' })
        .returning();
      await tx
        .insert(ledgerLines)
        .values({ entryId: entry!.id, accountId: account!.id, amount: 10, direction: 'credit' });
    }),
  ).rejects.toThrow();
  expect(await db.select().from(journalEntries)).toHaveLength(0);
});
it('payment events and audit records are append-only, and money identity is immutable', async () => {
  const { payment } = await fixture();
  await db
    .insert(paymentEvents)
    .values({ paymentId: payment.id, type: 'created', source: 'api', correlationId: payment.correlationId });
  await db
    .insert(auditLog)
    .values({ actor: 'ops@example.com', action: 'created', targetType: 'payment', targetId: payment.id });
  await expect(db.delete(paymentEvents)).rejects.toThrow();
  await expect(db.update(auditLog).set({ actor: 'someone else' })).rejects.toThrow();
  await expect(db.update(payments).set({ amount: 200 }).where(eq(payments.id, payment.id))).rejects.toThrow();
  expect(payment.id[14]).toBe('7');
});
