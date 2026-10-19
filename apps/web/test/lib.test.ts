import type { DepositRequest } from "@acex/shared";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/lib/api";
import { createIntentKeys } from "@/lib/idempotency";
import { clearSession, loadSession, saveSession } from "@/lib/session";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const request: DepositRequest = { amount_cents: 1000, currency: "USD", source_account: { holder_name: "Jane", iban: "GB82WEST12345698765432" } };

describe("api client (S4)", () => {
  it("sends the bearer token, idempotency key and JSON body to POST /v1/deposits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(202, { transaction_id: "txn_1", status: "PENDING", created: true, correlation_id: "c1" }));
    const res = await createApiClient("http://api", fetchMock).createDeposit("tok", "idk_1", request);
    expect(res).toEqual({ ok: true, value: { transaction_id: "txn_1", status: "PENDING", created: true, correlation_id: "c1" } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api/v1/deposits");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer tok", "idempotency-key": "idk_1", "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it("maps contract errors to code, message and correlation id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(409, { code: "IDEMPOTENCY_KEY_CONFLICT", message: "reused", correlation_id: "c2" }));
    expect(await createApiClient("http://api", fetchMock).createDeposit("tok", "k", request)).toEqual({
      ok: false,
      error: { code: "IDEMPOTENCY_KEY_CONFLICT", message: "reused", correlationId: "c2" },
    });
  });

  it("falls back to the HTTP status for non-contract failures and to NETWORK_ERROR when unreachable", async () => {
    const bad = vi.fn().mockResolvedValue(new Response("oops", { status: 502 }));
    expect(await createApiClient("http://api", bad).listDeposits("t")).toMatchObject({ ok: false, error: { code: "HTTP_502" } });
    const down = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect(await createApiClient("http://api", down).listDeposits("t")).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR" } });
  });

  it("lists deposits with GET and login with POST /v1/auth/dev-login", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { items: [] }));
    const api = createApiClient("http://api", fetchMock);
    await api.listDeposits("tok");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api/v1/deposits");
    expect(fetchMock.mock.calls[0]![1].method).toBe("GET");
    await api.devLogin({ tenant_id: "t", user_id: "u" });
    expect(fetchMock.mock.calls[1]![0]).toBe("http://api/v1/auth/dev-login");
    expect(fetchMock.mock.calls[1]![1].headers.authorization).toBeUndefined();
  });
});

describe("intent keys (S4)", () => {
  it("reuses the key for the same request until it is resolved, and renews it for a changed request", () => {
    let n = 0;
    const keys = createIntentKeys(() => `idk_${++n}`);
    expect(keys.keyFor(request)).toBe("idk_1");
    expect(keys.keyFor({ ...request })).toBe("idk_1");
    expect(keys.keyFor({ ...request, amount_cents: 2000 })).toBe("idk_2");
    keys.resolved();
    expect(keys.keyFor({ ...request, amount_cents: 2000 })).toBe("idk_3");
  });

  it("default keys satisfy the API key format", () => {
    expect(createIntentKeys().keyFor(request)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});

describe("session storage", () => {
  it("round-trips, clears and ignores corrupt data", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    expect(loadSession(storage)).toBeNull();
    saveSession({ token: "t", tenant_id: "a", user_id: "b" }, storage);
    expect(loadSession(storage)).toEqual({ token: "t", tenant_id: "a", user_id: "b" });
    clearSession(storage);
    expect(loadSession(storage)).toBeNull();
    store.set("acex.session", "{not json");
    expect(loadSession(storage)).toBeNull();
  });
});
