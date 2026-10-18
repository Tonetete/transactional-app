import { createDb } from "./db/client.js";
import { SimulatedBank } from "./bank.js";
import { createJsonLogger } from "./logger.js";
import { createSqsHandler } from "./worker/sqs-handler.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing required env var DATABASE_URL");

// TODO(phase bank-integration): replace SimulatedBank once the provider contract exists.
/** Lambda entry point (SQS event source mapping with ReportBatchItemFailures). */
export const handler = createSqsHandler({
  db: createDb(databaseUrl),
  bank: new SimulatedBank("clear"),
  logger: createJsonLogger(),
});
