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
const sqs = new SQSClient({});
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
