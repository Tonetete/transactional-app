// Executable form of specs/03-CONTRACT-SPEC.md: shapes shared by the web client, API, worker and queue.

/** HTTP headers of the deposit endpoint. Tenant and user come from the verified JWT; X-Tenant-Id is optional and must match. */
export const HEADERS = {
  idempotencyKey: "idempotency-key",
  correlationId: "x-correlation-id",
  tenantId: "x-tenant-id",
} as const;

export const ERROR_CODES = [
  "UNAUTHORIZED",
  "TENANT_MISMATCH",
  "INVALID_IDEMPOTENCY_KEY",
  "IDEMPOTENCY_KEY_CONFLICT",
  "INVALID_BODY",
  "INVALID_AMOUNT",
  "AMOUNT_EXCEEDS_LIMIT",
  "INVALID_CURRENCY",
  "INVALID_IBAN",
  "INVALID_ACCOUNT_HOLDER",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Error body: predictable code, human-readable message and the correlation id for support. */
export interface ErrorResponse {
  code: ErrorCode;
  message: string;
  correlation_id: string;
}

/** 202 on first creation (`created: true`), 200 on an idempotent replay (`created: false`, current status). */
export interface DepositResponse {
  transaction_id: string;
  status: import("./index.js").TransactionStatus;
  created: boolean;
  correlation_id: string;
}

// ---- Asynchronous messaging contract ----

export const EVENT_SCHEMA_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1];

export interface DepositRequestedData {
  transaction_id: string;
  account_id: string;
  amount_cents: number;
  currency: string;
  source_account: { holder_name: string; iban: string };
}

export interface DepositRequestedEvent {
  event_id: string;
  event_type: "DepositRequested";
  schema_version: number;
  occurred_at: string; // UTC, ISO 8601 with trailing Z
  tenant_id: string;
  correlation_id: string;
  data: DepositRequestedData;
}

export function buildDepositRequestedEvent(input: {
  tenantId: string;
  correlationId: string;
  data: DepositRequestedData;
}): DepositRequestedEvent {
  return {
    event_id: `evt_${globalThis.crypto.randomUUID()}`,
    event_type: "DepositRequested",
    schema_version: EVENT_SCHEMA_VERSION,
    occurred_at: new Date().toISOString(),
    tenant_id: input.tenantId,
    correlation_id: input.correlationId,
    data: input.data,
  };
}

export type ParseEventResult =
  | { ok: true; event: DepositRequestedEvent }
  | { ok: false; code: "INVALID_EVENT" | "UNSUPPORTED_SCHEMA_VERSION"; message: string };

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Consumer-side validation. Unknown extra fields are ignored so producers can evolve within a schema version. */
export function parseDepositRequestedEvent(raw: unknown): ParseEventResult {
  const invalid = (message: string): ParseEventResult => ({ ok: false, code: "INVALID_EVENT", message });
  if (!isObject(raw)) return invalid("event must be an object");

  if (typeof raw.schema_version !== "number") return invalid("schema_version is required");
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(raw.schema_version)) {
    return { ok: false, code: "UNSUPPORTED_SCHEMA_VERSION", message: `schema_version ${raw.schema_version} is not supported` };
  }
  if (raw.event_type !== "DepositRequested") return invalid("event_type must be DepositRequested");
  if (!nonEmpty(raw.event_id)) return invalid("event_id is required");
  if (!nonEmpty(raw.occurred_at) || !UTC_ISO.test(raw.occurred_at) || Number.isNaN(Date.parse(raw.occurred_at))) {
    return invalid("occurred_at must be a UTC ISO 8601 timestamp");
  }
  if (!nonEmpty(raw.tenant_id)) return invalid("tenant_id is required");
  if (!nonEmpty(raw.correlation_id)) return invalid("correlation_id is required");

  const d = raw.data;
  if (!isObject(d)) return invalid("data is required");
  const src = d.source_account;
  if (
    !nonEmpty(d.transaction_id) ||
    !nonEmpty(d.account_id) ||
    typeof d.amount_cents !== "number" ||
    !Number.isSafeInteger(d.amount_cents) ||
    d.amount_cents <= 0 ||
    typeof d.currency !== "string" ||
    !/^[A-Z]{3}$/.test(d.currency) ||
    !isObject(src) ||
    !nonEmpty(src.holder_name) ||
    !nonEmpty(src.iban)
  ) {
    return invalid("data does not match the DepositRequested payload");
  }
  return { ok: true, event: raw as unknown as DepositRequestedEvent };
}

/** One row of GET /v1/deposits (newest first). */
export interface DepositListItem {
  transaction_id: string;
  amount_cents: number;
  currency: string;
  status: import("./index.js").TransactionStatus;
  created_at: string;
}

export interface DepositListResponse {
  items: DepositListItem[];
}

/** Body and response of the development-only POST /v1/auth/dev-login. */
export interface DevLoginRequest {
  tenant_id: string;
  user_id: string;
}
export interface DevLoginResponse extends DevLoginRequest {
  token: string;
}
