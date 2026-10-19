-- Append-only record of funds moved into an account. transactions is the state machine;
-- ledger_entries is the immutable evidence behind accounts.balance_cents.
CREATE TABLE ledger_entries (
  id             text PRIMARY KEY DEFAULT 'led_' || gen_random_uuid(),
  tenant_id      text NOT NULL REFERENCES tenants(id),
  account_id     text NOT NULL REFERENCES accounts(id),
  transaction_id text NOT NULL UNIQUE REFERENCES transactions(id), -- one entry per transaction, ever
  entry_type     text NOT NULL CHECK (entry_type IN ('CREDIT')),
  amount_cents   bigint NOT NULL CHECK (amount_cents > 0),
  currency       char(3) NOT NULL,
  correlation_id text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ledger_entries
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

-- Application roles can only read and append.
GRANT SELECT, INSERT ON ledger_entries TO app_user;

-- Defense in depth: even a role with UPDATE/DELETE privileges cannot rewrite history.
CREATE FUNCTION ledger_entries_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is immutable (% blocked)', TG_OP;
END $$;

CREATE TRIGGER ledger_entries_no_change
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();
CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_immutable();
