import { parseDepositRequestedEvent } from "@acex/shared";
import { withTenant, type Db } from "../db/client.js";
import type { BankClient } from "../bank.js";
import { noopLogger, type Logger } from "../logger.js";

export interface WorkerDeps {
  db: Db; // connected as app_user: every step runs under the event's tenant RLS context
  bank: BankClient;
  logger?: Logger;
}

/**
 * Settles one deposit. Safe under at-least-once delivery: the status guard in each UPDATE makes every
 * transition (and the single ledger credit that rides on SETTLED) happen at most once, and the bank
 * is called with the transaction id as idempotency reference.
 */
export async function processDeposit(deps: WorkerDeps, rawEvent: unknown): Promise<void> {
  const parsed = parseDepositRequestedEvent(rawEvent);
  if (!parsed.ok) throw new Error(`Invalid event: ${parsed.message}`);
  const event = parsed.event;
  const { tenant_id: tenantId, correlation_id: correlationId } = event;
  const transactionId = event.data.transaction_id;

  // 1. Claim: PENDING -> PROCESSING (a retry finds PROCESSING and simply continues).
  const claimed = await withTenant(
    deps.db,
    tenantId,
    async (trx) => {
      await trx
        .updateTable("transactions")
        .set({ status: "PROCESSING", updated_at: new Date() })
        .where("id", "=", transactionId)
        .where("status", "=", "PENDING")
        .execute();
      const row = await trx
        .selectFrom("transactions")
        .select(["id", "status", "amount_cents", "currency"])
        .where("id", "=", transactionId)
        .executeTakeFirst();
      if (!row) throw new Error(`Transaction ${transactionId} not found for tenant ${tenantId}`);
      return row;
    },
    correlationId,
  );
  if (claimed.status !== "PROCESSING") return; // already SETTLED or FAILED

  // 2. External call, outside any DB transaction. Throws when the bank is down.
  const result = await deps.bank.requestTransfer({
    reference: transactionId,
    amount_cents: Number(claimed.amount_cents),
    currency: claimed.currency,
    source_account: event.data.source_account,
    correlation_id: correlationId,
  });

  // 3. Finalize atomically: status change and credit commit together or not at all.
  const final = result.outcome === "CLEARED" ? "SETTLED" : "FAILED";
  const transitioned = await withTenant(
    deps.db,
    tenantId,
    async (trx) => {
      const done = await trx
        .updateTable("transactions")
        .set({ status: final, updated_at: new Date() })
        .where("id", "=", transactionId)
        .where("status", "=", "PROCESSING")
        .returning(["account_id", "amount_cents"])
        .executeTakeFirst();
      if (done && final === "SETTLED") {
        await trx
          .updateTable("accounts")
          .set((eb) => ({ balance_cents: eb("balance_cents", "+", done.amount_cents) }))
          .where("id", "=", done.account_id)
          .execute();
      }
      return done !== undefined;
    },
    correlationId,
  );
  if (transitioned) {
    (deps.logger ?? noopLogger).info(final === "SETTLED" ? "deposit_settled" : "deposit_failed", {
      correlation_id: correlationId,
      tenant_id: tenantId,
      transaction_id: transactionId,
      ...(result.outcome === "REJECTED" ? { reason: result.reason } : {}),
    });
  }
}
