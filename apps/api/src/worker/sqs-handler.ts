import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { noopLogger } from "../logger.js";
import { processDeposit, type WorkerDeps } from "./process-deposit.js";

function correlationIdOf(body: string): string | undefined {
  try {
    const id = (JSON.parse(body) as { correlation_id?: unknown }).correlation_id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lambda entry point for the SQS event source mapping (ReportBatchItemFailures enabled).
 * A failing record is reported individually: SQS makes it visible again and, after maxReceiveCount
 * receives (3, set on the queue's redrive policy), moves it to the DLQ. Successful records are not retried.
 */
export function createSqsHandler(deps: WorkerDeps) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        await processDeposit(deps, JSON.parse(record.body));
      } catch (err) {
        (deps.logger ?? noopLogger).error("record_failed", {
          correlation_id: correlationIdOf(record.body),
          message_id: record.messageId,
          error: err instanceof Error ? err.message : String(err),
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}
