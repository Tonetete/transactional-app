import { Kysely, PostgresDialect, sql, type ColumnType, type Generated } from "kysely";
import pg from "pg";
import type { TransactionStatus } from "@acex/shared";

type Cents = ColumnType<string, string | number | bigint, string | number | bigint>; // bigint comes back as string

export interface Database {
  tenants: { id: string; name: string; created_at: Generated<Date> };
  accounts: {
    id: Generated<string>;
    tenant_id: string;
    user_id: string;
    currency: string;
    balance_cents: Generated<string>;
    created_at: Generated<Date>;
  };
  transactions: {
    id: Generated<string>;
    tenant_id: string;
    account_id: string;
    user_id: string;
    type: Generated<"DEPOSIT">;
    amount_cents: Cents;
    currency: string;
    status: Generated<TransactionStatus>;
    idempotency_key: string;
    request_hash: string;
    correlation_id: string;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
  ledger_entries: {
    id: Generated<string>;
    tenant_id: string;
    account_id: string;
    transaction_id: string;
    entry_type: "CREDIT";
    amount_cents: Cents;
    currency: string;
    correlation_id: string;
    created_at: Generated<Date>;
  };
  outbox: {
    id: Generated<string>;
    tenant_id: string;
    transaction_id: string;
    event_type: string;
    payload: unknown;
    correlation_id: string;
    created_at: Generated<Date>;
    published_at: Date | null;
  };
}

export type Db = Kysely<Database>;

export function createDb(connectionString: string): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }) });
}

/** Runs fn in a transaction whose RLS context is the given tenant (SET LOCAL semantics). */
export function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (trx: Kysely<Database>) => Promise<T>,
  correlationId?: string,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.current_tenant_id', ${tenantId}, true)`.execute(trx);
    if (correlationId) {
      // application_name is printed by Postgres log prefixes (%a), tying DB logs to the request.
      await sql`select set_config('application_name', ${`corr:${correlationId}`}, true)`.execute(trx);
    }
    return fn(trx);
  });
}
