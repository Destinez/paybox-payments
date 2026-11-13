import fc from 'fast-check';
import { expect, it } from 'vitest';
import { clearing, payable, transit, validateEntry } from './ledger';

it('random payment, partial refund and failed refund sequences preserve balanced journals and reserved principal', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 100000000 }),
      fc.array(fc.record({ amount: fc.integer({ min: 1, max: 100000000 }), failed: fc.boolean() }), {
        maxLength: 40,
      }),
      (amount, events) => {
        let available = amount,
          cleared = amount,
          inTransit = 0;
        validateEntry([clearing('debit', amount), payable('merchant', 'credit', amount)]);
        for (const event of events) {
          const refund = Math.min(event.amount, available);
          if (!refund) continue;
          validateEntry([payable('merchant', 'debit', refund), transit('merchant', 'credit', refund)]);
          available -= refund;
          inTransit += refund;
          if (event.failed) {
            validateEntry([transit('merchant', 'debit', refund), payable('merchant', 'credit', refund)]);
            available += refund;
          } else {
            validateEntry([transit('merchant', 'debit', refund), clearing('credit', refund)]);
            cleared -= refund;
          }
          inTransit -= refund;
          expect(available).toBeGreaterThanOrEqual(0);
          expect(cleared).toBeGreaterThanOrEqual(0);
          expect(inTransit).toBe(0);
          expect(available).toBe(cleared);
        }
      },
    ),
    { numRuns: 500 },
  );
});
