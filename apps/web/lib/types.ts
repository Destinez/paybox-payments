export type User = { id: string; email: string; role: 'admin' | 'ops' | 'viewer' };
export type Payment = {
  id: string;
  merchant_id: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  customer: { email: string };
  authorization_url: string | null;
  access_code: string | null;
  fees: number | null;
  channel: string | null;
  paid_at: string | null;
  refunded_amount: number;
  created_at: string;
  correlation_id: string;
};
export type Timeline = {
  id: string;
  created_at: string;
  type: string;
  source: string;
  correlation_id: string;
  detail: Record<string, unknown>;
};
export type Refund = {
  id: string;
  reference: string;
  amount: number;
  status: string;
  reason: string;
  createdAt: string;
};
export type LedgerLine = {
  id: string;
  entry_id: string;
  kind: string;
  account: string;
  direction: string;
  amount: number;
  created_at: string;
};
export type PaymentDetail = Payment & {
  timeline: Timeline[];
  refunds: Refund[];
  ledger_entries: LedgerLine[];
};
export type Run = {
  id: string;
  status: string;
  checked: number;
  matched: number;
  mismatched: number;
  createdAt: string;
  finishedAt: string | null;
  items?: Finding[];
};
export type Finding = {
  id: string;
  paymentId: string | null;
  kind: string;
  local: Record<string, unknown>;
  remote: Record<string, unknown>;
  resolution: string;
  note: string | null;
  resolvedBy: string | null;
};
export type Summary = {
  volume_today: string;
  total: number;
  successful: number;
  success_rate: number;
  dlq_depth: number;
  last_reconciliation: Run | null;
  series: { day: string; volume: string; count: number }[];
  mode: string;
};
export type Job = {
  id: string;
  type: string;
  aggregateId: string | null;
  status: string;
  attempts: number;
  totalAttempts: number;
  lastError: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
  history: {
    id: string;
    attemptNo: number;
    outcome: string;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }[];
};
