import { describe, expect, it } from "vitest";
import { MAX_DEPOSIT_CENTS, isValidIdempotencyKey, parseDepositRequest } from "../src/index.js";

const valid = {
  amount_cents: 5_000_000, // $50,000
  currency: "USD",
  source_account: { holder_name: "Jane Doe", iban: "GB82 WEST 1234 5698 7654 32" },
};

const codes = (body: unknown) => {
  const r = parseDepositRequest(body);
  return r.ok ? [] : r.issues.map((i) => i.code);
};

describe("parseDepositRequest", () => {
  it("accepts a valid $50,000 deposit and normalizes the IBAN", () => {
    const r = parseDepositRequest(valid);
    expect(r).toEqual({
      ok: true,
      value: {
        amount_cents: 5_000_000,
        currency: "USD",
        source_account: { holder_name: "Jane Doe", iban: "GB82WEST12345698765432" },
      },
    });
  });

  it("rejects a negative amount (-$5,000)", () => {
    expect(codes({ ...valid, amount_cents: -500_000 })).toEqual(["INVALID_AMOUNT"]);
  });

  it("rejects zero, fractional, non-numeric and missing amounts", () => {
    for (const amount_cents of [0, 50.5, "5000", null, undefined]) {
      expect(codes({ ...valid, amount_cents })).toEqual(["INVALID_AMOUNT"]);
    }
  });

  it("rejects amounts above the operational ceiling but accepts the ceiling itself", () => {
    expect(codes({ ...valid, amount_cents: MAX_DEPOSIT_CENTS + 1 })).toEqual(["AMOUNT_EXCEEDS_LIMIT"]);
    expect(codes({ ...valid, amount_cents: MAX_DEPOSIT_CENTS })).toEqual([]);
  });

  it("rejects malformed currency", () => {
    for (const currency of ["usd", "US", "USDX", 5, undefined]) {
      expect(codes({ ...valid, currency })).toEqual(["INVALID_CURRENCY"]);
    }
  });

  it("rejects invalid IBANs (bad checksum, bad format) and blank holder", () => {
    expect(codes({ ...valid, source_account: { ...valid.source_account, iban: "GB82WEST12345698765433" } })).toEqual([
      "INVALID_IBAN",
    ]);
    expect(codes({ ...valid, source_account: { ...valid.source_account, iban: "nope" } })).toEqual(["INVALID_IBAN"]);
    expect(codes({ ...valid, source_account: { ...valid.source_account, holder_name: "  " } })).toEqual([
      "INVALID_ACCOUNT_HOLDER",
    ]);
  });

  it("rejects a non-object body and a missing source_account", () => {
    expect(codes(null)).toEqual(["INVALID_BODY"]);
    expect(codes({ amount_cents: 1, currency: "USD" })).toEqual(["INVALID_IBAN", "INVALID_ACCOUNT_HOLDER"]);
  });
});

describe("isValidIdempotencyKey", () => {
  it("accepts alphanumeric keys with _ and - up to 64 chars", () => {
    for (const k of ["idk_999", "abc-123", "A".repeat(64)]) expect(isValidIdempotencyKey(k)).toBe(true);
  });
  it("rejects empty, too long, or keys with other characters", () => {
    for (const k of ["", "A".repeat(65), "has space", "semi;colon", undefined, 5]) {
      expect(isValidIdempotencyKey(k)).toBe(false);
    }
  });
});
