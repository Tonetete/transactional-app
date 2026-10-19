/** Operational ceiling per deposit: $1,000,000.00 (in minor units). */
export const MAX_DEPOSIT_CENTS = 100_000_000;

export type DepositIssueCode =
  | "INVALID_BODY"
  | "INVALID_AMOUNT"
  | "AMOUNT_EXCEEDS_LIMIT"
  | "INVALID_CURRENCY"
  | "INVALID_IBAN"
  | "INVALID_ACCOUNT_HOLDER";

export interface DepositIssue {
  code: DepositIssueCode;
  message: string;
}

export interface DepositRequest {
  amount_cents: number;
  currency: string;
  source_account: { holder_name: string; iban: string };
}

export type ParseResult =
  { ok: true; value: DepositRequest } | { ok: false; issues: DepositIssue[] };

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && IDEMPOTENCY_KEY.test(key);
}

/** ISO 13616 structure + mod-97 checksum. Expects an already normalized (no spaces, upper-case) IBAN. */
/** See https://en.wikipedia.org/wiki/International_Bank_Account_Number#Validating_the_IBAN. */
function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

export function parseDepositRequest(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      ok: false,
      issues: [
        { code: "INVALID_BODY", message: "Request body must be a JSON object" },
      ],
    };
  }
  const b = body as Record<string, unknown>;
  const issues: DepositIssue[] = [];

  const amount = b.amount_cents;
  if (
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0
  ) {
    issues.push({
      code: "INVALID_AMOUNT",
      message: "amount_cents must be a positive integer",
    });
  } else if (amount > MAX_DEPOSIT_CENTS) {
    issues.push({
      code: "AMOUNT_EXCEEDS_LIMIT",
      message: `amount_cents must not exceed ${MAX_DEPOSIT_CENTS}`,
    });
  }

  const currency = b.currency;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    issues.push({
      code: "INVALID_CURRENCY",
      message: "currency must be a 3-letter upper-case ISO 4217 code",
    });
  }

  const src =
    typeof b.source_account === "object" && b.source_account !== null
      ? (b.source_account as Record<string, unknown>)
      : {};
  const iban =
    typeof src.iban === "string"
      ? src.iban.replace(/\s+/g, "").toUpperCase()
      : "";
  if (!isValidIban(iban)) {
    issues.push({
      code: "INVALID_IBAN",
      message: "source_account.iban is not a valid IBAN",
    });
  }
  const holder =
    typeof src.holder_name === "string" ? src.holder_name.trim() : "";
  if (holder.length === 0 || holder.length > 140) {
    issues.push({
      code: "INVALID_ACCOUNT_HOLDER",
      message: "source_account.holder_name must be 1-140 characters",
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      amount_cents: amount as number,
      currency: currency as string,
      source_account: { holder_name: holder, iban },
    },
  };
}
