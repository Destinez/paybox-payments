import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertBalanced, canTransitionRefund, createPaymentSchema, idempotencyMatches, ledgerEntries, parseNaira, requestHash, retryDelay, verifySignature } from './index';

describe('webhook authentication', () => {
  const secret = 'unit-test-fixture';
  const raw = Buffer.from('{ "event": "charge.success", "data": {"id": 42} }');
  const signature = createHmac('sha512', secret).update(raw).digest('hex');
  it('authenticates the exact bytes', () => {
    expect(verifySignature(raw, signature, secret)).toBe(true);
    expect(verifySignature(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))), signature, secret)).toBe(false);
  });
  it.each([undefined, '', 'zz'.repeat(64), 'ff'.repeat(63), 'ff'.repeat(64)])('rejects malformed or incorrect signature %s', (input) => {
    expect(verifySignature(raw, input, secret)).toBe(false);
  });
});

describe('idempotency fingerprints', () => {
  it('ignores object key ordering while distinguishing payment values', () => {
    const hash = requestHash({ email: 'a@example.com', amount: 12500 });
    expect(idempotencyMatches(hash, { amount: 12500, email: 'a@example.com' })).toBe(true);
    expect(idempotencyMatches(hash, { amount: 12501, email: 'a@example.com' })).toBe(false);
  });
});

describe('money and ledger', () => {
  it('parses decimal naira exactly', () => {
    expect(parseNaira('0.29')).toBe(29);
    expect(parseNaira('12500.5')).toBe(1250050);
  });
  it.each(['1.001', '-1', '0', '1e5', 'Infinity', '100000000000000000'])('rejects unsafe money %s', (value) => expect(() => parseNaira(value)).toThrow());
  it('rejects fractional kobo and unknown fields', () => {
    expect(createPaymentSchema.safeParse({ email: 'a@example.com', amount: 0.5 }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ email: 'a@example.com', amount: 100, extra: true }).success).toBe(false);
  });
  it('balances each journal and reverses refund postings', () => {
    expect(() => assertBalanced(ledgerEntries('payment', 250_000))).not.toThrow();
    expect(() => assertBalanced(ledgerEntries('refund', 50_000))).not.toThrow();
    expect(ledgerEntries('refund', 50_000)[0]?.side).toBe('credit');
    expect(() => assertBalanced([{ account: 'paystack_clearing', side: 'debit', amount: 10 }, { account: 'merchant_payable', side: 'credit', amount: 9 }])).toThrow('balanced');
  });
});

describe('retries and refund states', () => {
  it('uses bounded exponential backoff and full jitter', () => {
    expect(retryDelay(1, () => 0.5)).toBe(500);
    expect(retryDelay(4, () => 0.5)).toBe(4000);
    expect(retryDelay(20, () => 1)).toBe(300000);
    expect(retryDelay(3, () => 0)).toBe(0);
    expect(() => retryDelay(0)).toThrow();
  });
  it('prevents regression from terminal refund states', () => {
    expect(canTransitionRefund('pending', 'processing')).toBe(true);
    expect(canTransitionRefund('processing', 'succeeded')).toBe(true);
    expect(canTransitionRefund('succeeded', 'processing')).toBe(false);
    expect(canTransitionRefund('failed', 'succeeded')).toBe(false);
  });
});
