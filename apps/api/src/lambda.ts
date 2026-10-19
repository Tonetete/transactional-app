import { createDb } from "./db/client.js";
import { loadDbCredentials } from "./db/secret.js";
import { resolveDatabaseUrl } from "./db/url.js";
import { SimulatedBank } from "./bank.js";
import { createJsonLogger } from "./logger.js";
import { createSqsHandler } from "./worker/sqs-handler.js";

await loadDbCredentials(process.env); // cold start only

// TODO(phase bank-integration): replace SimulatedBank once the provider contract exists.
/** Lambda entry point (SQS event source mapping with ReportBatchItemFailures). */
export const handler = createSqsHandler({
  db: createDb(resolveDatabaseUrl(process.env, "DATABASE_URL")),
  bank: new SimulatedBank("clear"),
  logger: createJsonLogger(),
});
