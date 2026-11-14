CREATE TABLE "fake_settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nonce_key" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fake_settlements_nonce_key_unique" UNIQUE("nonce_key")
);
--> statement-breakpoint
CREATE TABLE "x402_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"nonce_key" text NOT NULL,
	"payer" text NOT NULL,
	"amount" bigint NOT NULL,
	"asset" text NOT NULL,
	"network" text NOT NULL,
	"pay_to" text NOT NULL,
	"status" text DEFAULT 'verified' NOT NULL,
	"transaction_hash" text,
	"receipt" jsonb,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL,
	"last_error" text,
	"settlement_started_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x402_payments_nonce_key_unique" UNIQUE("nonce_key"),
	CONSTRAINT "x402_payment_amount_valid" CHECK ("x402_payments"."amount">0 AND "x402_payments"."amount"<=10000000000)
);
--> statement-breakpoint
CREATE TABLE "x402_routes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"upstream_url" text NOT NULL,
	"price" bigint NOT NULL,
	"asset" text NOT NULL,
	"network" text NOT NULL,
	"pay_to" text NOT NULL,
	"description" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x402_price_valid" CHECK ("x402_routes"."price">0 AND "x402_routes"."price"<=10000000000),
	CONSTRAINT "x402_testnet_only" CHECK ("x402_routes"."network"='eip155:84532')
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "currency" text DEFAULT 'NGN' NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "x402_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "slug" text DEFAULT 'm-' || gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "x402_payments" ADD CONSTRAINT "x402_payments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payments" ADD CONSTRAINT "x402_payments_route_id_x402_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."x402_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_routes" ADD CONSTRAINT "x402_routes_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "x402_payment_merchant" ON "x402_payments" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "x402_route_unique" ON "x402_routes" USING btree ("merchant_id","method","path");--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_x402_payment_id_x402_payments_id_fk" FOREIGN KEY ("x402_payment_id") REFERENCES "public"."x402_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_slug_unique" UNIQUE("slug");
--> statement-breakpoint
CREATE FUNCTION assert_book_currency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_currency text; entry_currency text;
BEGIN
  SELECT currency INTO account_currency FROM ledger_accounts WHERE id=NEW.account_id;
  SELECT currency INTO entry_currency FROM journal_entries WHERE id=NEW.entry_id;
  IF account_currency IS DISTINCT FROM entry_currency THEN
    RAISE EXCEPTION 'Journal currency must match every account currency';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_currency_check BEFORE INSERT ON ledger_lines FOR EACH ROW EXECUTE FUNCTION assert_book_currency();
--> statement-breakpoint
CREATE FUNCTION protect_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.code, NEW.type, NEW.currency, NEW.merchant_id) IS DISTINCT FROM (OLD.code, OLD.type, OLD.currency, OLD.merchant_id) THEN
    RAISE EXCEPTION 'Ledger account identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_identity_check BEFORE UPDATE ON ledger_accounts FOR EACH ROW EXECUTE FUNCTION protect_account_identity();
--> statement-breakpoint
ALTER TABLE journal_entries ADD CONSTRAINT journal_book_allowed CHECK (currency IN ('NGN','USDC') AND (x402_payment_id IS NULL OR (currency='USDC' AND payment_id IS NULL AND refund_id IS NULL)));
