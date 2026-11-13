-- A journal and both entries must commit together, including under direct SQL writes.
CREATE FUNCTION assert_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  journal_uuid uuid;
  entry_count bigint;
  account_count bigint;
  net numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN journal_uuid := NEW.id;
  ELSE journal_uuid := NEW.entry_id;
  END IF;
  SELECT count(*), count(DISTINCT account_id), coalesce(sum(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0)
    INTO entry_count, account_count, net FROM ledger_lines WHERE entry_id = journal_uuid;
  IF entry_count < 2 OR account_count < 2 OR net <> 0 THEN
    RAISE EXCEPTION 'Journal % must contain two balanced entries across distinct accounts', journal_uuid;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_balance_check AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_balance_check AFTER INSERT ON ledger_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();
--> statement-breakpoint
CREATE FUNCTION reject_accounting_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Accounting entries are append-only; post a reversing journal';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON ledger_lines
  FOR EACH ROW EXECUTE FUNCTION reject_accounting_mutation();
--> statement-breakpoint
CREATE TRIGGER journals_immutable BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION reject_accounting_mutation();
--> statement-breakpoint
CREATE FUNCTION protect_payment_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.amount, NEW.currency, NEW.reference) IS DISTINCT FROM (OLD.amount, OLD.currency, OLD.reference) THEN
    RAISE EXCEPTION 'Payment amount, currency and reference are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_identity_immutable BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION protect_payment_identity();

--> statement-breakpoint
CREATE TRIGGER payment_events_immutable BEFORE UPDATE OR DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION reject_accounting_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_accounting_mutation();
