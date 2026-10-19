import {
  HEADERS,
  type DepositListResponse,
  type DepositRequest,
  type DepositResponse,
  type DevLoginRequest,
  type DevLoginResponse,
  type ErrorResponse,
} from "@acex/shared";

export type ApiError = { code: string; message: string; correlationId?: string };
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export interface ApiClient {
  devLogin(body: DevLoginRequest): Promise<ApiResult<DevLoginResponse>>;
  createDeposit(token: string, idempotencyKey: string, request: DepositRequest): Promise<ApiResult<DepositResponse>>;
  listDeposits(token: string): Promise<ApiResult<DepositListResponse>>;
}

export function createApiClient(baseUrl: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): ApiClient {
  async function call<T>(path: string, init: RequestInit & { token?: string; headers?: Record<string, string> }): Promise<ApiResult<T>> {
    const { token, headers, ...rest } = init;
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...rest,
        headers: { ...(rest.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      });
    } catch {
      return { ok: false, error: { code: "NETWORK_ERROR", message: "Could not reach the API" } };
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, value: body as T };
    const err = body as Partial<ErrorResponse> | null;
    return {
      ok: false,
      error: {
        code: err?.code ?? `HTTP_${res.status}`,
        message: err?.message ?? `Request failed with status ${res.status}`,
        correlationId: err?.correlation_id ?? res.headers.get(HEADERS.correlationId) ?? undefined,
      },
    };
  }

  return {
    devLogin: (body) => call("/v1/auth/dev-login", { method: "POST", body: JSON.stringify(body) }),
    createDeposit: (token, key, request) =>
      call("/v1/deposits", { method: "POST", token, body: JSON.stringify(request), headers: { [HEADERS.idempotencyKey]: key } }),
    listDeposits: (token) => call("/v1/deposits", { method: "GET", token }),
  };
}
