import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { startTestDb, type TestDb } from "./helpers/db.js";
import { withTenant } from "../src/db/client.js";

let t: TestDb;

async function seed() {
  for (const id of ["tnt_a", "tnt_b"]) {
    await t.admin.insertInto("tenants").values({ id, name: id }).execute();
    await t.admin
      .insertInto("accounts")
      .values({ id: `acc_${id}`, tenant_id: id, user_id: "usr_1", currency: "USD" })
      .execute();
  }
}

const tx = (tenant: string, key: string, over: Record<string, unknown> = {}) => ({
  tenant_id: tenant,
  account_id: `acc_${tenant}`,
  user_id: "usr_1",
  amount_cents: "5000000",
  currency: "USD",
  idempotency_key: key,
  request_hash: "h",
  correlation_id: "c1",
  ...over,
});

beforeAll(async () => {
  t = await startTestDb();
  await seed();
});
afterAll(async () => {
  await t.stop();
});

describe("schema and RLS", () => {
  it("new transactions default to PENDING and balance starts at 0", async () => {
    const row = await withTenant(t.app, "tnt_a", (db) =>
      db.insertInto("transactions").values(tx("tnt_a", "k1")).returningAll().executeTakeFirstOrThrow(),
    );
    expect(row.status).toBe("PENDING");
    const acc = await withTenant(t.app, "tnt_a", (db) =>
      db.selectFrom("accounts").selectAll().executeTakeFirstOrThrow(),
    );
    expect(acc.balance_cents).toBe("0");
  });

  it("a tenant only sees its own rows", async () => {
    await withTenant(t.app, "tnt_b", (db) => db.insertInto("transactions").values(tx("tnt_b", "kb")).execute());
    const rowsA = await withTenant(t.app, "tnt_a", (db) => db.selectFrom("transactions").selectAll().execute());
    expect(rowsA.every((r) => r.tenant_id === "tnt_a")).toBe(true);
    expect(rowsA.length).toBeGreaterThan(0);
  });

  it("without tenant context no rows are visible", async () => {
    const rows = await t.app.selectFrom("transactions").selectAll().execute();
    expect(rows).toEqual([]);
  });

  it("rejects inserting a row for another tenant", async () => {
    await expect(
      withTenant(t.app, "tnt_a", (db) => db.insertInto("transactions").values(tx("tnt_b", "evil")).execute()),
    ).rejects.toThrow(/row-level security/);
  });

  it("enforces UNIQUE(tenant_id, idempotency_key) but allows the same key in another tenant", async () => {
    await expect(
      withTenant(t.app, "tnt_a", (db) => db.insertInto("transactions").values(tx("tnt_a", "k1")).execute()),
    ).rejects.toThrow(/duplicate key/);
    await withTenant(t.app, "tnt_b", (db) => db.insertInto("transactions").values(tx("tnt_b", "k1")).execute());
  });

  it("rejects non-positive amounts and unknown statuses at the database level", async () => {
    await expect(
      withTenant(t.app, "tnt_a", (db) =>
        db.insertInto("transactions").values(tx("tnt_a", "neg", { amount_cents: "-500000" })).execute(),
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      withTenant(t.app, "tnt_a", (db) =>
        db.insertInto("transactions").values(tx("tnt_a", "bad", { status: "DONE" })).execute(),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("app_user cannot delete transactions (ledger is immutable)", async () => {
    await expect(
      withTenant(t.app, "tnt_a", (db) => sql`delete from transactions`.execute(db)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("ledger_entries table", () => {
  const entry = (tenant: string, txnId: string) => ({
    tenant_id: tenant,
    account_id: `acc_${tenant}`,
    transaction_id: txnId,
    entry_type: "CREDIT" as const,
    amount_cents: "5000000",
    currency: "USD",
    correlation_id: "c1",
  });
  let txnA: string;
  let txnB: string;

  beforeAll(async () => {
    txnA = (await withTenant(t.app, "tnt_a", (db) => db.selectFrom("transactions").select("id").where("idempotency_key", "=", "k1").executeTakeFirstOrThrow())).id;
    txnB = (await withTenant(t.app, "tnt_b", (db) => db.selectFrom("transactions").select("id").where("idempotency_key", "=", "kb").executeTakeFirstOrThrow())).id;
    await withTenant(t.app, "tnt_a", (db) => db.insertInto("ledger_entries").values(entry("tnt_a", txnA)).execute());
  });

  it("is isolated per tenant by RLS", async () => {
    expect(await withTenant(t.app, "tnt_b", (db) => db.selectFrom("ledger_entries").selectAll().execute())).toEqual([]);
    expect(await t.app.selectFrom("ledger_entries").selectAll().execute()).toEqual([]);
    await expect(
      withTenant(t.app, "tnt_a", (db) => db.insertInto("ledger_entries").values(entry("tnt_b", txnB)).execute()),
    ).rejects.toThrow(/row-level security/);
  });

  it("allows only one entry per transaction", async () => {
    await expect(
      withTenant(t.app, "tnt_a", (db) => db.insertInto("ledger_entries").values(entry("tnt_a", txnA)).execute()),
    ).rejects.toThrow(/duplicate key/);
  });

  it("rejects non-positive amounts", async () => {
    await expect(
      withTenant(t.app, "tnt_b", (db) =>
        db.insertInto("ledger_entries").values({ ...entry("tnt_b", txnB), amount_cents: "0" }).execute(),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("cannot be updated or deleted, not even by a superuser", async () => {
    await expect(
      withTenant(t.app, "tnt_a", (db) => sql`update ledger_entries set amount_cents = 1`.execute(db)),
    ).rejects.toThrow(/permission denied/);
    await expect(sql`update ledger_entries set amount_cents = 1`.execute(t.admin)).rejects.toThrow(/immutable/);
    await expect(sql`delete from ledger_entries`.execute(t.admin)).rejects.toThrow(/immutable/);
    await expect(sql`truncate ledger_entries`.execute(t.admin)).rejects.toThrow(/immutable/);
  });
});
