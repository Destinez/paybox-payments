CREATE TYPE "public"."job_status" AS ENUM('pending', 'in_flight', 'succeeded', 'dead');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('created', 'pending', 'succeeded', 'failed', 'abandoned', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('requested', 'pending', 'processing', 'needs_attention', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_prefix_unique" UNIQUE("prefix")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_valid" CHECK ("dashboard_users"."role" IN ('admin','ops','viewer'))
);
--> statement-breakpoint
CREATE TABLE "fake_refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"transaction" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fake_refunds_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "fake_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fake_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"fees" bigint DEFAULT 0 NOT NULL,
	"drift" integer DEFAULT 0 NOT NULL,
	"failures_remaining" integer DEFAULT 0 NOT NULL,
	"delay_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fake_transactions_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"locked_until" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text DEFAULT 'running' NOT NULL,
	"http_status" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payment_id" uuid,
	"refund_id" uuid,
	"idempotency_ref" text NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_idempotency_ref_unique" UNIQUE("idempotency_ref")
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"merchant_id" uuid,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ledger_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_amount_valid" CHECK ("ledger_lines"."amount">0 AND "ledger_lines"."amount"<=10000000000),
	CONSTRAINT "line_direction_valid" CHECK ("ledger_lines"."direction" IN ('debit','credit'))
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"webhook_url" text,
	"webhook_secret_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"aggregate_id" uuid,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"total_attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_until" timestamp with time zone,
	"lease_owner" uuid,
	"last_error" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"source" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" "payment_status" DEFAULT 'created' NOT NULL,
	"customer_email" text NOT NULL,
	"paystack_id" numeric(20, 0),
	"access_code" text,
	"authorization_url" text,
	"channel" text,
	"fees" bigint,
	"paid_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"refunded_amount" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"correlation_id" text NOT NULL,
	"callback_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_reference_unique" UNIQUE("reference"),
	CONSTRAINT "payments_paystack_id_unique" UNIQUE("paystack_id"),
	CONSTRAINT "payment_amount_valid" CHECK ("payments"."amount">0 AND "payments"."amount"<=10000000000),
	CONSTRAINT "payment_currency_valid" CHECK ("payments"."currency"='NGN'),
	CONSTRAINT "payment_refunded_valid" CHECK ("payments"."refunded_amount">=0 AND "payments"."refunded_amount"<="payments"."amount"),
	CONSTRAINT "payment_fees_valid" CHECK ("payments"."fees">=0 AND "payments"."fees"<="payments"."amount")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"tokens" numeric NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"payment_id" uuid,
	"kind" text NOT NULL,
	"local" jsonb NOT NULL,
	"remote" jsonb NOT NULL,
	"resolution" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"window_from" timestamp with time zone NOT NULL,
	"window_to" timestamp with time zone NOT NULL,
	"checked" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"mismatched" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" "refund_status" DEFAULT 'requested' NOT NULL,
	"paystack_refund_id" numeric(20, 0),
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_paystack_refund_id_unique" UNIQUE("paystack_refund_id"),
	CONSTRAINT "refund_amount_valid" CHECK ("refunds"."amount">0 AND "refunds"."amount"<=10000000000)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'paystack' NOT NULL,
	"event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"body_sha256" text NOT NULL,
	"raw_body" "bytea" NOT NULL,
	"signature_kid" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"payment_id" uuid,
	"refund_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_job_id_outbox_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."outbox_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_dashboard_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_webhook_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."webhook_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "dashboard_users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_merchant_key" ON "idempotency_keys" USING btree ("merchant_id","key");--> statement-breakpoint
CREATE INDEX "idempotency_expiry" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_attempt_unique" ON "job_attempts" USING btree ("job_id","attempt_no");--> statement-breakpoint
CREATE INDEX "ledger_entry_idx" ON "ledger_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "outbox_claim_idx" ON "outbox_jobs" USING btree ("status","run_after") WHERE "outbox_jobs"."status" IN ('pending','in_flight');--> statement-breakpoint
CREATE INDEX "outbox_aggregate_idx" ON "outbox_jobs" USING btree ("aggregate_id");--> statement-breakpoint
CREATE INDEX "payment_events_timeline" ON "payment_events" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_merchant_created" ON "payments" USING btree ("merchant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payment_status_created" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recon_item_unique" ON "reconciliation_items" USING btree ("run_id","payment_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_reference_unique" ON "refunds" USING btree (lower("reference"));--> statement-breakpoint
CREATE INDEX "refund_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "webhook_received_idx" ON "webhook_events" USING btree ("received_at" DESC NULLS LAST);