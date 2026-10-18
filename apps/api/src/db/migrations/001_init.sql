DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN;
  END IF;
END $$;

CREATE TABLE tenants (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id            text PRIMARY KEY DEFAULT 'acc_' || gen_random_uuid(),
  tenant_id     text NOT NULL REFERENCES tenants(id),
  user_id       text NOT NULL,
  currency      char(3) NOT NULL,
  balance_cents bigint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, currency)
);

CREATE TABLE transactions (
  id              text PRIMARY KEY DEFAULT 'txn_' || gen_random_uuid(),
  tenant_id       text NOT NULL REFERENCES tenants(id),
  account_id      text NOT NULL REFERENCES accounts(id),
  user_id         text NOT NULL,
  type            text NOT NULL DEFAULT 'DEPOSIT' CHECK (type IN ('DEPOSIT')),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  currency        char(3) NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','PROCESSING','SETTLED','FAILED')),
  idempotency_key text NOT NULL,
  request_hash    text NOT NULL,
  correlation_id  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE outbox (
  id             text PRIMARY KEY DEFAULT 'evt_' || gen_random_uuid(),
  tenant_id      text NOT NULL REFERENCES tenants(id),
  transaction_id text NOT NULL REFERENCES transactions(id),
  event_type     text NOT NULL,
  payload        jsonb NOT NULL,
  correlation_id text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);

ALTER TABLE tenants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants      FORCE ROW LEVEL SECURITY;
ALTER TABLE accounts     FORCE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox       FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.current_tenant_id', true))
  WITH CHECK (id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON accounts
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON transactions
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON outbox
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

GRANT SELECT ON tenants TO app_user;
GRANT SELECT, INSERT, UPDATE ON accounts, transactions, outbox TO app_user;
