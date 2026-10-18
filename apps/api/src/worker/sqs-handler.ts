import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { processDeposit, type WorkerDeps } from "./process-deposit.js";

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
      } catch {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}
