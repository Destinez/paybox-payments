export const paymentStateNames = [
  'created',
  'pending',
  'succeeded',
  'failed',
  'abandoned',
  'partially_refunded',
  'refunded',
] as const;
export const paymentEventNames = [
  'initialize_ok',
  'initialize_rejected',
  'verified_success',
  'verified_failed',
  'verified_abandoned',
  'timeout',
  'partial_refund',
  'full_refund',
] as const;
export type PaymentState = (typeof paymentStateNames)[number];
export type PaymentEvent = (typeof paymentEventNames)[number];
export const paymentTransitions: Partial<Record<PaymentState, Partial<Record<PaymentEvent, PaymentState>>>> =
  {
    created: { initialize_ok: 'pending', initialize_rejected: 'failed' },
    pending: {
      verified_success: 'succeeded',
      verified_failed: 'failed',
      verified_abandoned: 'abandoned',
      timeout: 'abandoned',
    },
    abandoned: { verified_success: 'succeeded' },
    succeeded: { partial_refund: 'partially_refunded', full_refund: 'refunded' },
    partially_refunded: { partial_refund: 'partially_refunded', full_refund: 'refunded' },
  };
export function transitionPayment(state: PaymentState, event: PaymentEvent): PaymentState | Error {
  return paymentTransitions[state]?.[event] ?? new Error(`Illegal payment transition: ${state} / ${event}`);
}
