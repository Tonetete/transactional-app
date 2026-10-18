import { SendMessageBatchCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { Db } from "../db/client.js";
import { noopLogger, type Logger } from "../logger.js";

export interface PublisherConfig {
  db: Db; // connected as the outbox_relay role
  sqs: SQSClient;
  queueUrl: string;
  batchSize?: number;
  logger?: Logger;
}

const SQS_BATCH_LIMIT = 10;

/**
 * Publishes one batch of unpublished outbox events to SQS and returns how many were published.
 * Rows are locked with SKIP LOCKED so concurrent relays take disjoint batches. Delivery is
 * at-least-once: if the process dies after SQS accepted a message but before commit, the event
 * is sent again, which the idempotent consumer tolerates.
 */
export function publishPending({ db, sqs, queueUrl, batchSize = SQS_BATCH_LIMIT, logger = noopLogger }: PublisherConfig): Promise<number> {
  const limit = Math.min(batchSize, SQS_BATCH_LIMIT);
  return db.transaction().execute(async (trx) => {
    const rows = await trx
      .selectFrom("outbox")
      .select(["id", "tenant_id", "transaction_id", "event_type", "correlation_id", "payload"])
      .where("published_at", "is", null)
      .orderBy("created_at")
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();
    if (rows.length === 0) return 0;

    const result = await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: rows.map((r) => ({
          Id: r.id,
          MessageBody: JSON.stringify(r.payload),
          MessageAttributes: {
            correlation_id: { DataType: "String", StringValue: r.correlation_id },
            tenant_id: { DataType: "String", StringValue: r.tenant_id },
            event_type: { DataType: "String", StringValue: r.event_type },
          },
        })),
      }),
    );

    const failed = new Set((result.Failed ?? []).map((f) => f.Id));
    const sentRows = rows.filter((r) => !failed.has(r.id));
    if (sentRows.length > 0) {
      await trx
        .updateTable("outbox")
        .set({ published_at: new Date() })
        .where("id", "in", sentRows.map((r) => r.id))
        .execute();
    }
    for (const r of sentRows) {
      logger.info("outbox_published", {
        correlation_id: r.correlation_id,
        tenant_id: r.tenant_id,
        outbox_id: r.id,
        transaction_id: r.transaction_id,
        event_type: r.event_type,
      });
    }
    return sentRows.length;
  });
}
