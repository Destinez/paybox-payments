import { sql } from 'drizzle-orm';
import { pgTable, pgEnum, uuid, text, bigint, integer, timestamp, jsonb, uniqueIndex, index, check } from 'drizzle-orm/pg-core';

const time = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => bigint(name, { mode: 'number' });
export const paymentStatus = pgEnum('payment_status', ['initializing', 'pending', 'succeeded', 'failed']);
export const refundStatus = pgEnum('refund_status', ['pending', 'processing', 'succeeded', 'failed']);
export const jobStatus = pgEnum('job_status', ['pending', 'processing', 'completed', 'dead']);

export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  reference: text('reference').notNull().unique(),
  email: text('email').notNull(),
  amount: money('amount').notNull(),
  currency: text('currency').notNull().default('NGN'),
  description: text('description').notNull().default(''),
  status: paymentStatus('status').notNull().default('initializing'),
  authorizationUrl: text('authorization_url'),
  providerId: text('provider_id'),
  paidAt: time('paid_at'),
  createdAt: time('created_at').notNull().defaultNow(),
  updatedAt: time('updated_at').notNull().defaultNow()
}, (t) => [check('payment_amount_valid', sql`${t.amount} > 0 AND ${t.amount} <= 10000000000`), check('payment_currency_ngn', sql`${t.currency} = 'NGN'`), index('payments_created_idx').on(t.createdAt), index('payments_status_idx').on(t.status)]);

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  requestHash: text('request_hash').notNull(),
  statusCode: integer('status_code').notNull(),
  response: jsonb('response').$type<Record<string, unknown>>().notNull(),
  createdAt: time('created_at').notNull().defaultNow()
});

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventKey: text('event_key').notNull().unique(),
  providerEventId: text('provider_event_id'),
  eventType: text('event_type').notNull(),
  reference: text('reference'),
  paymentId: uuid('payment_id').references(() => payments.id),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('received'),
  receivedAt: time('received_at').notNull().defaultNow(),
  processedAt: time('processed_at')
}, (t) => [index('events_payment_idx').on(t.paymentId)]);

export const refunds = pgTable('refunds', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  amount: money('amount').notNull(),
  reason: text('reason').notNull(),
  status: refundStatus('status').notNull().default('pending'),
  providerId: text('provider_id').unique(),
  submissionStartedAt: time('submission_started_at'),
  failureReason: text('failure_reason'),
  createdAt: time('created_at').notNull().defaultNow(),
  updatedAt: time('updated_at').notNull().defaultNow()
}, (t) => [check('refund_amount_valid', sql`${t.amount} > 0 AND ${t.amount} <= 10000000000`), index('refunds_payment_idx').on(t.paymentId)]);

export const outbox = pgTable('outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  kind: text('kind').notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  paymentId: uuid('payment_id').references(() => payments.id),
  payload: jsonb('payload').$type<Record<string, string>>().notNull(),
  status: jobStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  totalAttempts: integer('total_attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(8),
  replayCount: integer('replay_count').notNull().default(0),
  availableAt: time('available_at').notNull().defaultNow(),
  lockedUntil: time('locked_until'),
  lockToken: uuid('lock_token'),
  lastError: text('last_error'),
  createdAt: time('created_at').notNull().defaultNow(),
  completedAt: time('completed_at')
}, (t) => [index('outbox_claim_idx').on(t.status, t.availableAt), index('outbox_payment_idx').on(t.paymentId)]);

export const jobAttempts = pgTable('job_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobId: uuid('job_id').notNull().references(() => outbox.id),
  attempt: integer('attempt').notNull(),
  outcome: text('outcome').notNull().default('running'),
  error: text('error'),
  startedAt: time('started_at').notNull().defaultNow(),
  finishedAt: time('finished_at')
}, (t) => [uniqueIndex('job_attempt_unique').on(t.jobId, t.attempt)]);

export const journals = pgTable('journals', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  sourceId: uuid('source_id').notNull(),
  kind: text('kind').notNull(),
  currency: text('currency').notNull().default('NGN'),
  createdAt: time('created_at').notNull().defaultNow()
}, (t) => [uniqueIndex('journal_source_unique').on(t.kind, t.sourceId), check('journal_kind_valid', sql`${t.kind} IN ('payment', 'refund')`), check('journal_currency_ngn', sql`${t.currency} = 'NGN'`)]);

export const ledger = pgTable('ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  journalId: uuid('journal_id').notNull().references(() => journals.id),
  account: text('account').notNull(),
  side: text('side').notNull(),
  amount: money('amount').notNull(),
  createdAt: time('created_at').notNull().defaultNow()
}, (t) => [check('ledger_amount_valid', sql`${t.amount} > 0 AND ${t.amount} <= 10000000000`), check('ledger_side_valid', sql`${t.side} IN ('debit', 'credit')`), check('ledger_account_valid', sql`${t.account} IN ('paystack_clearing', 'merchant_payable')`), index('ledger_journal_idx').on(t.journalId)]);

export const reconciliationRuns = pgTable('reconciliation_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: text('status').notNull().default('running'),
  total: integer('total').notNull(),
  createdAt: time('created_at').notNull().defaultNow(),
  completedAt: time('completed_at')
});
export const reconciliationResults = pgTable('reconciliation_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id').notNull().references(() => reconciliationRuns.id),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  reference: text('reference').notNull(),
  status: text('status').notNull(),
  ledgerAmount: money('ledger_amount').notNull(),
  providerAmount: money('provider_amount'),
  providerStatus: text('provider_status'),
  reason: text('reason'),
  checkedAt: time('checked_at').notNull().defaultNow()
}, (t) => [uniqueIndex('reconciliation_result_unique').on(t.runId, t.paymentId)]);

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  action: text('action').notNull(),
  paymentId: uuid('payment_id').references(() => payments.id),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: time('created_at').notNull().defaultNow()
}, (t) => [index('audit_payment_idx').on(t.paymentId)]);

export const mockTransactions = pgTable('mock_transactions', {
  reference: text('reference').primaryKey(),
  providerId: uuid('provider_id').defaultRandom().notNull(),
  amount: money('amount').notNull(),
  currency: text('currency').notNull().default('NGN'),
  status: text('status').notNull().default('pending'),
  failuresRemaining: integer('failures_remaining').notNull().default(0),
  createdAt: time('created_at').notNull().defaultNow()
});
export const mockRefunds = pgTable('mock_refunds', {
  id: uuid('id').defaultRandom().primaryKey(),
  reference: text('reference').notNull().references(() => mockTransactions.reference),
  marker: text('marker').notNull().unique(),
  amount: money('amount').notNull(),
  status: text('status').notNull().default('processed'),
  createdAt: time('created_at').notNull().defaultNow()
});
