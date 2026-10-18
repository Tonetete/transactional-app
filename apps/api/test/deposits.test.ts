import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { startTestDb, type TestDb } from "./helpers/db.js";
import { TEST_JWT_SECRET, token } from "./helpers/auth.js";

let t: TestDb;
let app: ReturnType<typeof buildApp>;

const body = {
  amount_cents: 5_000_000, // $50,000
  currency: "USD",
  source_account: { holder_name: "Jane Doe", iban: "GB82WEST12345698765432" },
};

async function post(opts: {
  tenant?: string;
  user?: string;
  key?: string | null;
  payload?: unknown;
  correlation?: string;
  auth?: boolean;
}) {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) headers.authorization = `Bearer ${await token(opts.tenant ?? "tnt_abc", opts.user ?? "usr_123")}`;
  if (opts.key !== null) headers["idempotency-key"] = opts.key ?? "idk_1";
  if (opts.correlation) headers["x-correlation-id"] = opts.correlation;
  return app.inject({ method: "POST", url: "/v1/deposits", headers, payload: (opts.payload ?? body) as object });
}

const count = async (table: "transactions" | "outbox") =>
  Number((await t.admin.selectFrom(table).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow()).n);

beforeAll(async () => {
  t = await startTestDb();
  for (const id of ["tnt_abc", "tnt_xyz"]) await t.admin.insertInto("tenants").values({ id, name: id }).execute();
  app = buildApp({ db: t.app, jwtSecret: TEST_JWT_SECRET });
  await post({ key: "warmup" });
});
afterAll(async () => {
  await app.close();
  await t.stop();
});

describe("POST /v1/deposits — successful request (S1)", () => {
  it("returns 202, stores a PENDING transaction, leaves balance unchanged and queues DepositRequested", async () => {
    const res = await post({ key: "s1-key", correlation: "corr-s1" });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json).toMatchObject({ status: "PENDING", created: true, correlation_id: "corr-s1" });
    expect(json.transaction_id).toMatch(/^txn_/);
    expect(res.headers["x-correlation-id"]).toBe("corr-s1");

    const txn = await t.admin.selectFrom("transactions").selectAll().where("id", "=", json.transaction_id).executeTakeFirstOrThrow();
    expect(txn).toMatchObject({
      tenant_id: "tnt_abc",
      user_id: "usr_123",
      amount_cents: "5000000",
      currency: "USD",
      status: "PENDING",
      idempotency_key: "s1-key",
      correlation_id: "corr-s1",
    });

    const acc = await t.admin.selectFrom("accounts").selectAll().where("id", "=", txn.account_id).executeTakeFirstOrThrow();
    expect(acc.balance_cents).toBe("0");

    const events = await t.admin.selectFrom("outbox").selectAll().where("transaction_id", "=", json.transaction_id).execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: "DepositRequested", tenant_id: "tnt_abc", correlation_id: "corr-s1" });
    expect(events[0]!.payload).toMatchObject({
      schema_version: 1,
      tenant_id: "tnt_abc",
      correlation_id: "corr-s1",
      data: {
        transaction_id: json.transaction_id,
        account_id: txn.account_id,
        amount_cents: 5_000_000,
        currency: "USD",
        source_account: body.source_account,
      },
    });
  });

  it("generates a correlation id when none is supplied", async () => {
    const res = await post({ key: "gen-corr" });
    expect(res.statusCode).toBe(202);
    expect(res.json().correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers["x-correlation-id"]).toBe(res.json().correlation_id);
  });

  it("responds in under 200ms (S5)", async () => {
    const start = performance.now();
    const res = await post({ key: "latency" });
    expect(res.statusCode).toBe(202);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe("POST /v1/deposits — rejections leave stored data unchanged", () => {
  const rejects = async (opts: Parameters<typeof post>[0], status: number, code: string) => {
    const before = [await count("transactions"), await count("outbox")];
    const res = await post(opts);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ code, correlation_id: expect.any(String) });
    expect(res.json().message).toEqual(expect.any(String));
    expect([await count("transactions"), await count("outbox")]).toEqual(before);
  };

  it("rejects a negative amount (-$5,000) with 400 (S3)", () =>
    rejects({ key: "neg", payload: { ...body, amount_cents: -500_000 } }, 400, "INVALID_AMOUNT"));
  it("rejects an invalid IBAN with 400", () =>
    rejects({ key: "iban", payload: { ...body, source_account: { holder_name: "J", iban: "x" } } }, 400, "INVALID_IBAN"));
  it("rejects a missing idempotency key with 400", () => rejects({ key: null }, 400, "INVALID_IDEMPOTENCY_KEY"));
  it("rejects a malformed idempotency key with 400", () => rejects({ key: "bad key!" }, 400, "INVALID_IDEMPOTENCY_KEY"));
  it("rejects unauthenticated requests with 401", () => rejects({ auth: false }, 401, "UNAUTHORIZED"));

  it("rejects a token signed with another secret with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/deposits",
      headers: { authorization: `Bearer ${await token("tnt_abc", "usr_123", "other-secret-other-secret-other-secret")}`, "idempotency-key": "k" },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects malformed JSON with 400 INVALID_BODY", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/deposits",
      headers: { authorization: `Bearer ${await token("tnt_abc", "usr_123")}`, "idempotency-key": "k", "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_BODY");
  });
});

describe("existing behavior preserved", () => {
  it("GET /health still responds 200 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
