-- The outbox relay reads events of every tenant, so it gets a dedicated role with a
-- permissive policy limited to the outbox table. Nothing else is visible to it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'outbox_relay') THEN
    CREATE ROLE outbox_relay LOGIN;
  END IF;
END $$;

CREATE POLICY relay_all_tenants ON outbox TO outbox_relay USING (true) WITH CHECK (true);
GRANT SELECT ON outbox TO outbox_relay;
GRANT UPDATE (published_at) ON outbox TO outbox_relay;
