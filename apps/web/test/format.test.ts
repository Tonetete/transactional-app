import { describe, expect, it } from "vitest";
import { formatMoney, parseAmountToCents } from "@/lib/format";

describe("parseAmountToCents", () => {
  it.each([
    ["50", 5000],
    ["50.5", 5050],
    ["1,250.05", 125005],
    [" 0.01 ", 1],
  ])("%s -> %i", (input, cents) => expect(parseAmountToCents(input)).toBe(cents));

  it.each(["", "abc", "0", "0.00", "-5", "1.234", "1e3", "9999999999999999999"])("rejects %j", (input) =>
    expect(parseAmountToCents(input)).toBeNull(),
  );
});

describe("formatMoney", () => {
  it("formats minor units", () => expect(formatMoney(5_000_000, "USD")).toBe("$50,000.00"));
});
