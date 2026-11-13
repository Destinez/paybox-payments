import { describe, expect, it } from 'vitest';
import { paymentEventNames, paymentStateNames, paymentTransitions, transitionPayment } from './payment';
import { refundEventNames, refundStateNames, refundTransitions, transitionRefund } from './refund';

describe('exhaustive state machine legality', () => {
  for (const state of paymentStateNames)
    for (const event of paymentEventNames)
      it(`payment ${state} / ${event}`, () => {
        const expected = paymentTransitions[state]?.[event],
          actual = transitionPayment(state, event);
        if (expected) expect(actual).toBe(expected);
        else expect(actual).toBeInstanceOf(Error);
      });
  for (const state of refundStateNames)
    for (const event of refundEventNames)
      it(`refund ${state} / ${event}`, () => {
        const expected = refundTransitions[state]?.[event],
          actual = transitionRefund(state, event);
        if (expected) expect(actual).toBe(expected);
        else expect(actual).toBeInstanceOf(Error);
      });
});
