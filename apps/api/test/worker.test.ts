import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { SimulatedBank } from "../src/bank.js";
import { processDeposit } from "../src/worker/process-deposit.js";
import { TEST_JWT_SECRET, token } from "./helpers/auth.js";
import { startTestDb, type TestDb } from "./helpers/db.js";

let t: TestDb;
let app: ReturnType<typeof buildApp>;

const body = {
  amount_cents: 5_000_000,
  currency: "USD",
  source_account: { holder_name: "Jane Doe", iban: "GB82WEST12345698765432" },
};

/** Creates a deposit through the public API and returns the DepositRequested event it queued. */
async function requestDeposit(key: string, tenant = "tnt_abc", user = `usr_${key}`) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/deposits",
    headers: { authorization: `Bearer ${await token(tenant, user)}`, "idempotency-key": key, "x-correlation-id": `corr-${key}` },
    payload: body,
  });
  expect(res.statusCode).toBe(202);
  const id = res.json().transaction_id as string;
  const row = await t.admin.selectFrom("outbox").select("payload").where("transaction_id", "=", id).executeTakeFirstOrThrow();
  return { id, event: row.payload as Record<string, any> };
}

const txn = (id: string) => t.admin.selectFrom("transactions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const balance = async (id: string) =>
  (await t.admin.selectFrom("accounts").select("balance_cents").where("id", "=", (await txn(id)).account_id).executeTakeFirstOrThrow())
    .balance_cents;

beforeAll(async () => {
  t = await startTestDb();
  for (const id of ["tnt_abc", "tnt_xyz"]) await t.admin.insertInto("tenants").values({ id, name: id }).execute();
  app = buildApp({ db: t.app, jwtSecret: TEST_JWT_SECRET });
});
afterAll(async () => {
  await app.close();
  await t.stop();
});

describe("processDeposit", () => {
  it("settles a cleared deposit: PENDING -> SETTLED and credits the ledger once", async () => {
    const { id, event } = await requestDeposit("w-ok");
    expect(await balance(id)).toBe("0");
    const bank = new SimulatedBank("clear");

    await processDeposit({ db: t.app, bank }, event);

    expect((await txn(id)).status).toBe("SETTLED");
    expect(await balance(id)).toBe("5000000");
    expect(bank.calls).toHaveLength(1);
    expect(bank.calls[0]).toMatchObject({
      reference: id,
      amount_cents: 5_000_000,
      currency: "USD",
      source_account: body.source_account,
    });
  });

  it("fails a rejected deposit: PENDING -> FAILED and leaves the balance untouched", async () => {
    const { id, event } = await requestDeposit("w-reject");
    await processDeposit({ db: t.app, bank: new SimulatedBank("reject") }, event);
    expect((await txn(id)).status).toBe("FAILED");
    expect(await balance(id)).toBe("0");
  });

  it("a redelivered message never credits the balance twice and does not call the bank again", async () => {
    const { id, event } = await requestDeposit("w-redeliver");
    const bank = new SimulatedBank("clear");
    await processDeposit({ db: t.app, bank }, event);
    await processDeposit({ db: t.app, bank }, event);
    expect(await balance(id)).toBe("5000000");
    expect(bank.calls).toHaveLength(1);
  });

  it("concurrent deliveries of the same message credit exactly once", async () => {
    const { id, event } = await requestDeposit("w-race");
    const bank = new SimulatedBank("clear");
    await Promise.all(Array.from({ length: 6 }, () => processDeposit({ db: t.app, bank }, event)));
    expect((await txn(id)).status).toBe("SETTLED");
    expect(await balance(id)).toBe("5000000");
  });

  it("a terminal state is never reverted by a later delivery", async () => {
    const { id, event } = await requestDeposit("w-final");
    await processDeposit({ db: t.app, bank: new SimulatedBank("reject") }, event);
    await processDeposit({ db: t.app, bank: new SimulatedBank("clear") }, event);
    expect((await txn(id)).status).toBe("FAILED");
    expect(await balance(id)).toBe("0");
  });

  it("when the bank is down it throws, keeps PROCESSING without credit, and a retry settles once", async () => {
    const { id, event } = await requestDeposit("w-down");
    const bank = new SimulatedBank("down");
    await expect(processDeposit({ db: t.app, bank }, event)).rejects.toThrow(/bank unavailable/);
    expect((await txn(id)).status).toBe("PROCESSING");
    expect(await balance(id)).toBe("0");

    bank.mode = "clear";
    await processDeposit({ db: t.app, bank }, event);
    expect((await txn(id)).status).toBe("SETTLED");
    expect(await balance(id)).toBe("5000000");
  });

  it("an event naming the wrong tenant cannot touch another tenant's transaction", async () => {
    const { id, event } = await requestDeposit("w-tenant", "tnt_abc");
    const forged = { ...event, tenant_id: "tnt_xyz" };
    const bank = new SimulatedBank("clear");
    await expect(processDeposit({ db: t.app, bank }, forged)).rejects.toThrow(/not found/);
    expect((await txn(id)).status).toBe("PENDING");
    expect(await balance(id)).toBe("0");
    expect(bank.calls).toHaveLength(0);
  });

  it("rejects malformed events without side effects", async () => {
    const bank = new SimulatedBank("clear");
    await expect(processDeposit({ db: t.app, bank }, { nope: true })).rejects.toThrow(/invalid event/i);
    expect(bank.calls).toHaveLength(0);
  });

  it("rejects an unsupported schema_version without calling the bank", async () => {
    const { event } = await requestDeposit("w-schema");
    const bank = new SimulatedBank("clear");
    const futureEvent = { ...event, schema_version: 2 };
    await expect(processDeposit({ db: t.app, bank }, futureEvent)).rejects.toThrow(/schema_version/);
    expect(bank.calls).toHaveLength(0);
  });
});
