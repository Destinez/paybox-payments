import { eq, sql } from 'drizzle-orm';
import type { Transaction } from './index';
import { journalEntries, ledgerAccounts, ledgerLines } from './schema';

export type PostingLine = {
  code: string;
  type: 'asset' | 'liability' | 'revenue' | 'expense';
  merchantId?: string;
  direction: 'debit' | 'credit';
  amount: number;
};
export function validateEntry(lines: PostingLine[]): void {
  if (lines.length < 2) throw new Error('A journal needs at least two lines');
  let net = 0n;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.amount) || line.amount <= 0 || line.amount > 10_000_000_000)
      throw new Error('Invalid ledger amount');
    net += (line.direction === 'debit' ? 1n : -1n) * BigInt(line.amount);
  }
  if (net !== 0n) throw new Error('Unbalanced journal');
}
export async function postEntry(
  tx: Transaction,
  input: {
    kind: string;
    paymentId?: string;
    refundId?: string;
    idempotencyRef: string;
    memo?: string;
    lines: PostingLine[];
  },
): Promise<string> {
  validateEntry(input.lines);
  const { lines, ...header } = input;
  const [entry] = await tx
    .insert(journalEntries)
    .values(header)
    .onConflictDoNothing({ target: journalEntries.idempotencyRef })
    .returning();
  if (!entry) {
    const [existing] = await tx
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.idempotencyRef, input.idempotencyRef));
    if (!existing) throw new Error('Journal conflict was not visible');
    return existing.id;
  }
  for (const line of lines) {
    const [account] = await tx
      .insert(ledgerAccounts)
      .values({ code: line.code, type: line.type, merchantId: line.merchantId })
      .onConflictDoUpdate({ target: ledgerAccounts.code, set: { code: sql`excluded.code` } })
      .returning();
    if (!account || account.type !== line.type || account.merchantId !== (line.merchantId ?? null))
      throw new Error('Ledger account identity mismatch');
    await tx
      .insert(ledgerLines)
      .values({ entryId: entry.id, accountId: account.id, direction: line.direction, amount: line.amount });
  }
  return entry.id;
}
export const clearing = (direction: 'debit' | 'credit', amount: number): PostingLine => ({
  code: 'paystack_clearing',
  type: 'asset',
  direction,
  amount,
});
export const payable = (merchantId: string, direction: 'debit' | 'credit', amount: number): PostingLine => ({
  code: `merchant_payable:${merchantId}`,
  type: 'liability',
  merchantId,
  direction,
  amount,
});
export const transit = (merchantId: string, direction: 'debit' | 'credit', amount: number): PostingLine => ({
  code: `refunds_in_transit:${merchantId}`,
  type: 'liability',
  merchantId,
  direction,
  amount,
});
