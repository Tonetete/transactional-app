import type { DepositRequest } from "@acex/shared";

const fingerprint = (r: DepositRequest) => JSON.stringify([r.amount_cents, r.currency, r.source_account.holder_name, r.source_account.iban]);

/**
 * One idempotency key per user intent: retrying the same request after a failure or timeout reuses
 * the key (so the API can deduplicate), while a changed request or a settled attempt gets a fresh one.
 */
export function createIntentKeys(generate: () => string = () => `idk_${crypto.randomUUID().replaceAll("-", "")}`) {
  let current: { fingerprint: string; key: string } | null = null;
  return {
    keyFor(request: DepositRequest): string {
      const fp = fingerprint(request);
      if (!current || current.fingerprint !== fp) current = { fingerprint: fp, key: generate() };
      return current.key;
    },
    /** Call once the API has accepted the request (202/200): the next identical request is a new intent. */
    resolved(): void {
      current = null;
    },
  };
}
