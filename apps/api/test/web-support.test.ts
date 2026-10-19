import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jwtVerify } from "jose";
import { buildApp } from "../src/app.js";
import { startTestDb, type TestDb } from "./helpers/db.js";
import { TEST_JWT_SECRET, token } from "./helpers/auth.js";

let t: TestDb;
let app: ReturnType<typeof buildApp>;
let plain: ReturnType<typeof buildApp>;

const authed = async (tenant: string, user: string) => ({ authorization: `Bearer ${await token(tenant, user)}` });

beforeAll(async () => {
  t = await startTestDb();
  app = buildApp({ db: t.app, jwtSecret: TEST_JWT_SECRET, devLogin: {
      provisionTenant: async (id) => {
        await t.admin.insertInto("tenants").values({ id, name: id }).onConflict((oc) => oc.column("id").doNothing()).execute();
      },
    }, corsOrigin: "http://localhost:3001" });
  plain = buildApp({ db: t.app, jwtSecret: TEST_JWT_SECRET });
});
afterAll(async () => {
  await app.close();
  await plain.close();
  await t.stop();
});

async function login(tenant_id: string, user_id: string) {
  return app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { tenant_id, user_id } });
}

async function post(tenant: string, user: string, key: string, amount: number) {
  return app.inject({
    method: "POST",
    url: "/v1/deposits",
    headers: { ...(await authed(tenant, user)), "idempotency-key": key },
    payload: { amount_cents: amount, currency: "USD", source_account: { holder_name: "Jane Doe", iban: "GB82WEST12345698765432" } },
  });
}

describe("POST /v1/auth/dev-login (S3)", () => {
  it("mints a verifiable HS256 JWT with sub and tenant_id, and provisions the tenant", async () => {
    const res = await login("tnt_web", "usr_web");
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toMatchObject({ tenant_id: "tnt_web", user_id: "usr_web" });
    const { payload } = await jwtVerify(json.token, new TextEncoder().encode(TEST_JWT_SECRET), { algorithms: ["HS256"] });
    expect(payload).toMatchObject({ sub: "usr_web", tenant_id: "tnt_web" });
    const tenant = await t.admin.selectFrom("tenants").selectAll().where("id", "=", "tnt_web").executeTakeFirst();
    expect(tenant).toBeDefined();
    // the minted token is accepted by the API
    expect((await post("tnt_web", "usr_web", "login-ok", 100)).statusCode).toBe(202);
  });

  it("is idempotent for an existing tenant", async () => {
    expect((await login("tnt_web", "usr_other")).statusCode).toBe(200);
  });

  it("rejects malformed ids with 400 INVALID_BODY", async () => {
    const res = await login("bad tenant!", "usr_1");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "INVALID_BODY" });
  });

  it("does not exist unless explicitly enabled (404)", async () => {
    const res = await plain.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { tenant_id: "tnt_web", user_id: "usr_web" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /v1/deposits (S1, S5)", () => {
  it("requires a bearer token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/deposits" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("lists the caller's deposits newest first and never another tenant's or user's", async () => {
    await login("tnt_list_a", "usr_a");
    await login("tnt_list_b", "usr_b");
    await post("tnt_list_a", "usr_a", "l1", 1000);
    await post("tnt_list_a", "usr_a", "l2", 2000);
    await post("tnt_list_a", "usr_c", "l3", 3000);
    await post("tnt_list_b", "usr_b", "l4", 4000);
    const res = await app.inject({ method: "GET", url: "/v1/deposits", headers: await authed("tnt_list_a", "usr_a") });
    expect(res.statusCode).toBe(200);
    const { items } = res.json();
    expect(items.map((i: { amount_cents: number }) => i.amount_cents)).toEqual([2000, 1000]);
    expect(items[0]).toMatchObject({ currency: "USD", status: "PENDING" });
    expect(items[0].transaction_id).toMatch(/^txn_/);
    expect(typeof items[0].created_at).toBe("string");
    expect(Object.keys(items[0]).sort()).toEqual(["amount_cents", "created_at", "currency", "status", "transaction_id"]);
  });
});

describe("CORS (S5)", () => {
  it("answers preflight for the configured origin", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/deposits",
      headers: { origin: "http://localhost:3001", "access-control-request-method": "POST" },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
    expect(String(res.headers["access-control-allow-headers"]).toLowerCase()).toContain("idempotency-key");
  });

  it("adds the allow-origin header to normal responses and exposes the correlation id", async () => {
    const res = await app.inject({ method: "GET", url: "/health", headers: { origin: "http://localhost:3001" } });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
    expect(String(res.headers["access-control-expose-headers"]).toLowerCase()).toContain("x-correlation-id");
  });

  it("does not send CORS headers for other origins or when unconfigured", async () => {
    const other = await app.inject({ method: "GET", url: "/health", headers: { origin: "http://evil.example" } });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    const off = await plain.inject({ method: "GET", url: "/health", headers: { origin: "http://localhost:3001" } });
    expect(off.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
