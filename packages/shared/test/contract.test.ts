import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  EVENT_SCHEMA_VERSION,
  buildDepositRequestedEvent,
  parseDepositRequestedEvent,
} from "../src/index.js";

const input = {
  tenantId: "tnt_abc",
  correlationId: "corr-1",
  data: {
    transaction_id: "txn_1",
    account_id: "acc_1",
    amount_cents: 5_000_000,
    currency: "USD",
    source_account: { holder_name: "Jane Doe", iban: "GB82WEST12345698765432" },
  },
};

describe("DepositRequested event contract (envelope + payload)", () => {
  it("builds an envelope with event id, schema version, UTC timestamp, tenant and correlation id", () => {
    const e = buildDepositRequestedEvent(input);
    expect(e).toMatchObject({
      event_type: "DepositRequested",
      schema_version: EVENT_SCHEMA_VERSION,
      tenant_id: "tnt_abc",
      correlation_id: "corr-1",
      data: input.data,
    });
    expect(e.event_id).toMatch(/^evt_[0-9a-f-]{36}$/);
    expect(e.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("generates a distinct event id per event", () => {
    expect(buildDepositRequestedEvent(input).event_id).not.toBe(buildDepositRequestedEvent(input).event_id);
  });

  it("round-trips through JSON and parse", () => {
    const e = buildDepositRequestedEvent(input);
    expect(parseDepositRequestedEvent(JSON.parse(JSON.stringify(e)))).toEqual({ ok: true, event: e });
  });

  it("tolerates unknown extra fields (backward-compatible evolution)", () => {
    const e = { ...buildDepositRequestedEvent(input), future_field: 1, data: { ...input.data, extra: true } };
    expect(parseDepositRequestedEvent(e).ok).toBe(true);
  });

  it("rejects an unsupported schema version with a dedicated code", () => {
    const e = { ...buildDepositRequestedEvent(input), schema_version: 2 };
    expect(parseDepositRequestedEvent(e)).toMatchObject({ ok: false, code: "UNSUPPORTED_SCHEMA_VERSION" });
  });

  it.each([
    ["event_id", undefined],
    ["schema_version", undefined],
    ["occurred_at", "2026-01-01T00:00:00+02:00"],
    ["occurred_at", "yesterday"],
    ["tenant_id", ""],
    ["correlation_id", 5],
    ["event_type", "SomethingElse"],
  ])("rejects an envelope with invalid %s (%s)", (field, value) => {
    const e = { ...buildDepositRequestedEvent(input), [field]: value };
    expect(parseDepositRequestedEvent(e)).toMatchObject({ ok: false, code: "INVALID_EVENT" });
  });

  it.each([
    ["transaction_id", undefined],
    ["account_id", ""],
    ["amount_cents", -1],
    ["amount_cents", 1.5],
    ["currency", "usd"],
    ["source_account", { holder_name: "x" }],
  ])("rejects a payload with invalid %s (%s)", (field, value) => {
    const base = buildDepositRequestedEvent(input);
    expect(parseDepositRequestedEvent({ ...base, data: { ...base.data, [field]: value } })).toMatchObject({
      ok: false,
      code: "INVALID_EVENT",
    });
  });

  it("rejects non-objects", () => {
    for (const v of [null, "x", 5, []]) expect(parseDepositRequestedEvent(v)).toMatchObject({ ok: false });
  });
});

describe("error codes", () => {
  it("lists the codes the API can return, without duplicates", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const c of ["UNAUTHORIZED", "INVALID_AMOUNT", "IDEMPOTENCY_KEY_CONFLICT", "INTERNAL_ERROR", "TENANT_MISMATCH"]) {
      expect(ERROR_CODES).toContain(c);
    }
  });
});
