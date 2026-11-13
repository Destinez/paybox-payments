import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { v7 } from 'uuid';

export const newId = v7;
const id = () => uuid('id').primaryKey().$defaultFn(v7);
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const time = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => bigint(name, { mode: 'number' });
// PostgreSQL bigint is signed; numeric(20,0) preserves the provider's full unsigned 64-bit identifiers.
const providerId = (name: string) => numeric(name, { precision: 20, scale: 0 });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
export const paymentStatus = pgEnum('payment_status', [
  'created',
  'pending',
  'succeeded',
  'failed',
  'abandoned',
  'partially_refunded',
  'refunded',
]);
export const refundStatus = pgEnum('refund_status', [
  'requested',
  'pending',
  'processing',
  'needs_attention',
  'processed',
  'failed',
]);
export const jobStatus = pgEnum('job_status', ['pending', 'in_flight', 'succeeded', 'dead']);

export const merchants = pgTable('merchants', {
  id: id(),
  name: text('name').notNull(),
  webhookUrl: text('webhook_url'),
  webhookSecretEnc: text('webhook_secret_enc'),
  createdAt: created(),
});
export const apiKeys = pgTable('api_keys', {
  id: id(),
  merchantId: uuid('merchant_id')
    .notNull()
    .references(() => merchants.id),
  prefix: text('prefix').notNull().unique(),
  keyHash: text('key_hash').notNull(),
  revokedAt: time('revoked_at'),
  createdAt: created(),
});
export const dashboardUsers = pgTable(
  'dashboard_users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').$type<'admin' | 'ops' | 'viewer'>().notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    check('user_role_valid', sql`${t.role} IN ('admin','ops','viewer')`),
  ],
);
export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => dashboardUsers.id),
  tokenHash: text('token_hash').notNull().unique(),
  csrfHash: text('csrf_hash').notNull(),
  expiresAt: time('expires_at').notNull(),
  createdAt: created(),
});
export const payments = pgTable(
  'payments',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    reference: text('reference').notNull().unique(),
    amount: money('amount').notNull(),
    currency: text('currency').notNull().default('NGN'),
    status: paymentStatus('status').notNull().default('created'),
    customerEmail: text('customer_email').notNull(),
    paystackId: providerId('paystack_id').unique(),
    accessCode: text('access_code'),
    authorizationUrl: text('authorization_url'),
    channel: text('channel'),
    fees: money('fees'),
    paidAt: time('paid_at'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    refundedAmount: money('refunded_amount').notNull().default(0),
    version: integer('version').notNull().default(0),
    correlationId: text('correlation_id').notNull(),
    callbackUrl: text('callback_url'),
    createdAt: created(),
  },
  (t) => [
    check('payment_amount_valid', sql`${t.amount}>0 AND ${t.amount}<=10000000000`),
    check('payment_currency_valid', sql`${t.currency}='NGN'`),
    check('payment_refunded_valid', sql`${t.refundedAmount}>=0 AND ${t.refundedAmount}<=${t.amount}`),
    check('payment_fees_valid', sql`${t.fees}>=0 AND ${t.fees}<=${t.amount}`),
    index('payment_merchant_created').on(t.merchantId, t.createdAt.desc()),
    index('payment_status_created').on(t.status, t.createdAt),
  ],
);
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: id(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    type: text('type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    source: text('source').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    correlationId: text('correlation_id').notNull(),
    createdAt: created(),
  },
  (t) => [index('payment_events_timeline').on(t.paymentId, t.createdAt)],
);
export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    reference: text('reference').notNull(),
    amount: money('amount').notNull(),
    status: refundStatus('status').notNull().default('requested'),
    paystackRefundId: providerId('paystack_refund_id').unique(),
    reason: text('reason').notNull(),
    requestedBy: text('requested_by').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('refund_reference_unique').on(sql`lower(${t.reference})`),
    index('refund_payment_idx').on(t.paymentId),
    check('refund_amount_valid', sql`${t.amount}>0 AND ${t.amount}<=10000000000`),
  ],
);
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    key: text('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    state: text('state').$type<'in_progress' | 'completed'>().notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<Record<string, unknown>>(),
    lockedUntil: time('locked_until').notNull(),
    expiresAt: time('expires_at').notNull(),
    paymentId: uuid('payment_id').references(() => payments.id),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('idempotency_merchant_key').on(t.merchantId, t.key),
    index('idempotency_expiry').on(t.expiresAt),
  ],
);
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    provider: text('provider').notNull().default('paystack'),
    eventKey: text('event_key').notNull().unique(),
    eventType: text('event_type').notNull(),
    bodySha256: text('body_sha256').notNull(),
    rawBody: bytea('raw_body').notNull(),
    signatureKid: text('signature_kid'),
    receivedAt: time('received_at').notNull().defaultNow(),
    status: text('status').notNull().default('received'),
    paymentId: uuid('payment_id').references(() => payments.id),
    refundId: uuid('refund_id').references(() => refunds.id),
    createdAt: created(),
  },
  (t) => [index('webhook_received_idx').on(t.receivedAt.desc())],
);
// One immutable delivery receipt per HTTP delivery makes duplicate attempts visible without reprocessing.
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: id(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => webhookEvents.id),
  outcome: text('outcome').notNull(),
  createdAt: created(),
});
export const outboxJobs = pgTable(
  'outbox_jobs',
  {
    id: id(),
    type: text('type').notNull(),
    aggregateId: uuid('aggregate_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: jobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    totalAttempts: integer('total_attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    runAfter: time('run_after').notNull().defaultNow(),
    leasedUntil: time('leased_until'),
    leaseOwner: uuid('lease_owner'),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key').notNull().unique(),
    createdAt: created(),
  },
  (t) => [
    index('outbox_claim_idx').on(t.status, t.runAfter).where(sql`${t.status} IN ('pending','in_flight')`),
    index('outbox_aggregate_idx').on(t.aggregateId),
  ],
);
export const jobAttempts = pgTable(
  'job_attempts',
  {
    id: id(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => outboxJobs.id),
    attemptNo: integer('attempt_no').notNull(),
    startedAt: time('started_at').notNull().defaultNow(),
    finishedAt: time('finished_at'),
    outcome: text('outcome').notNull().default('running'),
    httpStatus: integer('http_status'),
    error: text('error'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('job_attempt_unique').on(t.jobId, t.attemptNo)],
);
export const ledgerAccounts = pgTable('ledger_accounts', {
  id: id(),
  code: text('code').notNull().unique(),
  type: text('type').$type<'asset' | 'liability' | 'revenue' | 'expense'>().notNull(),
  merchantId: uuid('merchant_id').references(() => merchants.id),
  currency: text('currency').notNull().default('NGN'),
  createdAt: created(),
});
export const journalEntries = pgTable('journal_entries', {
  id: id(),
  kind: text('kind').notNull(),
  paymentId: uuid('payment_id').references(() => payments.id),
  refundId: uuid('refund_id').references(() => refunds.id),
  idempotencyRef: text('idempotency_ref').notNull().unique(),
  postedAt: time('posted_at').notNull().defaultNow(),
  memo: text('memo').notNull().default(''),
  createdAt: created(),
});
export const ledgerLines = pgTable(
  'ledger_lines',
  {
    id: id(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    direction: text('direction').$type<'debit' | 'credit'>().notNull(),
    amount: money('amount').notNull(),
    createdAt: created(),
  },
  (t) => [
    check('line_amount_valid', sql`${t.amount}>0 AND ${t.amount}<=10000000000`),
    check('line_direction_valid', sql`${t.direction} IN ('debit','credit')`),
    index('ledger_entry_idx').on(t.entryId),
  ],
);
export const reconciliationRuns = pgTable('reconciliation_runs', {
  id: id(),
  startedAt: time('started_at').notNull().defaultNow(),
  finishedAt: time('finished_at'),
  windowFrom: time('window_from').notNull(),
  windowTo: time('window_to').notNull(),
  checked: integer('checked').notNull().default(0),
  matched: integer('matched').notNull().default(0),
  mismatched: integer('mismatched').notNull().default(0),
  status: text('status').notNull().default('pending'),
  createdAt: created(),
});
export const reconciliationItems = pgTable(
  'reconciliation_items',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => reconciliationRuns.id),
    paymentId: uuid('payment_id').references(() => payments.id),
    kind: text('kind').notNull(),
    local: jsonb('local').$type<Record<string, unknown>>().notNull(),
    remote: jsonb('remote').$type<Record<string, unknown>>().notNull(),
    resolution: text('resolution').notNull().default('open'),
    resolvedBy: text('resolved_by'),
    note: text('note'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('recon_item_unique').on(t.runId, t.paymentId, t.kind)],
);
export const auditLog = pgTable('audit_log', {
  id: id(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  ip: text('ip'),
  createdAt: created(),
});
export const rateLimits = pgTable('rate_limits', {
  id: text('id').primaryKey(),
  tokens: numeric('tokens').notNull(),
  updatedAt: time('updated_at').notNull().defaultNow(),
  createdAt: created(),
});
export const fakeTransactions = pgTable('fake_transactions', {
  id: id(),
  reference: text('reference').notNull().unique(),
  amount: money('amount').notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull().default('pending'),
  fees: money('fees').notNull().default(0),
  drift: integer('drift').notNull().default(0),
  failuresRemaining: integer('failures_remaining').notNull().default(0),
  delayMs: integer('delay_ms').notNull().default(0),
  createdAt: created(),
});
export const fakeRefunds = pgTable('fake_refunds', {
  id: id(),
  reference: text('reference').notNull().unique(),
  transaction: text('transaction').notNull(),
  amount: money('amount').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: created(),
});
export const fakeSettings = pgTable('fake_settings', {
  id: text('id').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  createdAt: created(),
});

export const reconciliationChecks = pgTable(
  'reconciliation_checks',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => reconciliationRuns.id),
    reference: text('reference').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('reconciliation_check_unique').on(t.runId, t.reference)],
);
