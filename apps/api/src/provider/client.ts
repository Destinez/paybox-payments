export type InitializeInput = {
  email: string;
  amount: number;
  currency: 'NGN';
  reference: string;
  callback_url: string;
  metadata: Record<string, unknown>;
};
export type Initialization = { authorization_url: string; access_code: string; reference: string };
export type VerifiedTransaction = {
  id: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  fees: number;
  paid_at: string | null;
  channel: string;
  gateway_response: string;
};
export type RefundInput = {
  transaction: string;
  amount: number;
  currency: 'NGN';
  reference: string;
  merchant_note: string;
  customer_note?: string;
};
export type ProviderRefund = {
  id: string;
  reference: string;
  amount: number;
  status: string;
  transaction: string;
};
export interface PaystackClient {
  initialize(input: InitializeInput): Promise<Initialization>;
  verify(reference: string): Promise<VerifiedTransaction>;
  createRefund(input: RefundInput): Promise<ProviderRefund>;
  fetchRefundByReference(reference: string): Promise<ProviderRefund>;
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status = 503,
    public readonly retryAfterMs = 0,
  ) {
    super(message);
  }
  get retryable() {
    return [408, 429].includes(this.status) || this.status >= 500;
  }
}
