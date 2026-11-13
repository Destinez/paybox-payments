export const refundStateNames = [
  'requested',
  'pending',
  'processing',
  'needs_attention',
  'processed',
  'failed',
] as const;
export const refundEventNames = [
  'accepted',
  'processing',
  'attention',
  'processed',
  'failed',
  'resume',
] as const;
export type RefundState = (typeof refundStateNames)[number];
export type RefundEvent = (typeof refundEventNames)[number];
export const refundTransitions: Partial<Record<RefundState, Partial<Record<RefundEvent, RefundState>>>> = {
  requested: { accepted: 'pending', failed: 'failed' },
  pending: {
    processing: 'processing',
    attention: 'needs_attention',
    processed: 'processed',
    failed: 'failed',
  },
  processing: { attention: 'needs_attention', processed: 'processed', failed: 'failed' },
  needs_attention: { resume: 'processing' },
};
export function transitionRefund(state: RefundState, event: RefundEvent): RefundState | Error {
  return refundTransitions[state]?.[event] ?? new Error(`Illegal refund transition: ${state} / ${event}`);
}
