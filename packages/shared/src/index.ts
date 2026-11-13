import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const MAX_AMOUNT_KOBO = 100_000_000_00;
export const amountSchema = z.number().int().positive().max(MAX_AMOUNT_KOBO);
export const createPaymentSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    amount: amountSchema,
    currency: z.literal('NGN').default('NGN'),
    description: z.string().trim().max(160).default(''),
  })
  .strict();
export const createRefundSchema = z
  .object({ amount: amountSchema, reason: z.string().trim().min(3).max(160) })
  .strict();

export type CreatePayment = z.infer<typeof createPaymentSchema>;
export type RefundState = 'pending' | 'processing' | 'succeeded' | 'failed';
export type PaymentState = 'initializing' | 'pending' | 'succeeded' | 'failed';
export type JobKind =
  | 'payment.initialize'
  | 'payment.verify'
  | 'webhook.process'
  | 'refund.submit'
  | 'refund.check'
  | 'reconcile.payment';

/** Reject malformed hex before comparing equal-length digest buffers. */
export function verifySignature(rawBody: Uint8Array, signature: string | undefined, secret: string): boolean {
  if (!signature || !/^[a-fA-F0-9]{128}$/.test(signature)) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

export function idempotencyMatches(storedHash: string, body: unknown): boolean {
  return storedHash === requestHash(body);
}

/** Full jitter: each retry spreads uniformly across the exponential window. */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('Attempt must be a positive integer');
  return Math.floor(
    Math.max(0, Math.min(1, random())) * Math.min(300_000, 1_000 * 2 ** Math.min(attempt - 1, 20)),
  );
}

const refundTransitions: Record<RefundState, RefundState[]> = {
  pending: ['processing', 'failed'],
  processing: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
};
export function canTransitionRefund(from: RefundState, to: RefundState): boolean {
  return from === to || refundTransitions[from].includes(to);
}

export type LedgerEntry = {
  account: 'paystack_clearing' | 'merchant_payable';
  side: 'debit' | 'credit';
  amount: number;
};
export function ledgerEntries(kind: 'payment' | 'refund', amount: number): LedgerEntry[] {
  amountSchema.parse(amount);
  return [
    { account: 'paystack_clearing', side: kind === 'payment' ? 'debit' : 'credit', amount },
    { account: 'merchant_payable', side: kind === 'payment' ? 'credit' : 'debit', amount },
  ];
}
export function assertBalanced(entries: LedgerEntry[]): void {
  if (entries.length < 2) throw new Error('A journal needs at least two entries');
  const total = entries.reduce((sum, entry) => {
    amountSchema.parse(entry.amount);
    return sum + (entry.side === 'debit' ? BigInt(entry.amount) : -BigInt(entry.amount));
  }, 0n);
  if (total !== 0n) throw new Error('Journal is not balanced');
}

/** Parse decimal user input without floating point multiplication. */
export function parseNaira(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with at most two decimal places');
  const [whole = '0', fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount > BigInt(MAX_AMOUNT_KOBO) || amount <= 0n)
    throw new Error('Amount is outside the supported range');
  return Number(amount);
}

export * from './retry';
export * from './schemas';
export * from './signatures';
export { paymentEventNames, paymentStateNames, transitionPayment } from './state/payment';
export { refundEventNames, refundStateNames, transitionRefund } from './state/refund';
