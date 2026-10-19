// Pure presentation helpers. The only part of lib/ that components may import.

const CENTS_PER_UNIT = 100;

/** Parses a user-typed decimal amount ("1,250.5") into integer cents, or null when it is not a positive amount with at most 2 decimals. */
export function parseAmountToCents(input: string): number | null {
  const normalized = input.trim().replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const cents = Number(match[1]) * CENTS_PER_UNIT + Number((match[2] ?? "").padEnd(2, "0") || 0);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / CENTS_PER_UNIT);
}

export function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
}
