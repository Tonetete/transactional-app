import { createHash, randomUUID } from "node:crypto";
import type { DepositRequest } from "@acex/shared";
import { withTenant, type Db } from "./db/client.js";

export interface DepositInput {
  tenantId: string;
  userId: string;
  idempotencyKey: string;
  correlationId: string;
  request: DepositRequest;
}

export type DepositResult =
  | { kind: "ok"; transactionId: string; status: string; created: boolean }
  | { kind: "conflict" };

/** Stable fingerprint of what the client asked for; same key + different fingerprint is a conflict. */
export function requestHash(userId: string, request: DepositRequest): string {
  const canonical = JSON.stringify([
    userId,
    request.amount_cents,
    request.currency,
    request.source_account.holder_name,
    request.source_account.iban,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** Creates a PENDING deposit and its DepositRequested outbox event in one tenant-scoped transaction. */
export function createDeposit(db: Db, input: DepositInput): Promise<DepositResult> {
  const { tenantId, userId, idempotencyKey, correlationId, request } = input;
  const hash = requestHash(userId, request);
  return withTenant(
    db,
    tenantId,
    async (trx) => {
      await trx
        .insertInto("accounts")
        .values({ tenant_id: tenantId, user_id: userId, currency: request.currency })
        .onConflict((oc) => oc.columns(["tenant_id", "user_id", "currency"]).doNothing())
        .execute();
      const account = await trx
        .selectFrom("accounts")
        .select("id")
        .where("user_id", "=", userId)
        .where("currency", "=", request.currency)
        .executeTakeFirstOrThrow();

      const txn = await trx
        .insertInto("transactions")
        .values({
          tenant_id: tenantId,
          account_id: account.id,
          user_id: userId,
          amount_cents: request.amount_cents,
          currency: request.currency,
          idempotency_key: idempotencyKey,
          request_hash: hash,
          correlation_id: correlationId,
        })
        // A concurrent duplicate blocks on the unique index until the winner commits, then does nothing.
        .onConflict((oc) => oc.columns(["tenant_id", "idempotency_key"]).doNothing())
        .returning(["id", "status"])
        .executeTakeFirst();

      if (!txn) {
        // RLS scopes this lookup to the current tenant.
        const existing = await trx
          .selectFrom("transactions")
          .select(["id", "status", "request_hash"])
          .where("idempotency_key", "=", idempotencyKey)
          .executeTakeFirstOrThrow();
        if (existing.request_hash !== hash) return { kind: "conflict" as const };
        return { kind: "ok" as const, transactionId: existing.id, status: existing.status, created: false };
      }

      await trx
        .insertInto("outbox")
        .values({
          tenant_id: tenantId,
          transaction_id: txn.id,
          event_type: "DepositRequested",
          correlation_id: correlationId,
          payload: JSON.stringify({
            event_id: `evt_${randomUUID()}`,
            event_type: "DepositRequested",
            schema_version: 1,
            occurred_at: new Date().toISOString(),
            tenant_id: tenantId,
            correlation_id: correlationId,
            data: {
              transaction_id: txn.id,
              account_id: account.id,
              amount_cents: request.amount_cents,
              currency: request.currency,
              source_account: request.source_account,
            },
          }),
        })
        .execute();

      return { kind: "ok" as const, transactionId: txn.id, status: txn.status, created: true };
    },
    correlationId,
  );
}
