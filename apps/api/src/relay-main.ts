import { SQSClient } from "@aws-sdk/client-sqs";
import { createDb } from "./db/client.js";
import { resolveDatabaseUrl } from "./db/url.js";
import { createJsonLogger } from "./logger.js";
import { publishPending } from "./outbox/publisher.js";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
};

const logger = createJsonLogger();
const db = createDb(resolveDatabaseUrl(process.env, "RELAY_DATABASE_URL", "RELAY_DB"));
// Resolve the endpoint from the environment/region, not from the queue URL: an emulator returns queue URLs
// ("http://localhost:4566/...") that are unreachable from inside a task container, while AWS_ENDPOINT_URL is.
const sqs = new SQSClient({ useQueueUrlAsEndpoint: false });
const queueUrl = required("QUEUE_URL");
const idleMs = Number(process.env.RELAY_IDLE_MS ?? 500);

// Separate polling process: drains the outbox, sleeping only when it is empty.
for (;;) {
  try {
    const n = await publishPending({ db, sqs, queueUrl, logger });
    if (n === 0) await new Promise((r) => setTimeout(r, idleMs));
  } catch (err) {
    logger.error("relay_failed", { error: err instanceof Error ? err.message : String(err) });
    await new Promise((r) => setTimeout(r, idleMs));
  }
}
