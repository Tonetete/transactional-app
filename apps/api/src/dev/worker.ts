// Local stand-in for the Lambda event source mapping: long-polls the queue and feeds the real handler.
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { SQSEvent } from "aws-lambda";
import { SimulatedBank } from "../bank.js";
import { createDb } from "../db/client.js";
import { createJsonLogger } from "../logger.js";
import { createSqsHandler } from "../worker/sqs-handler.js";

const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
};

const mode = (process.env.BANK_MODE ?? "clear") as "clear" | "reject" | "down";
const logger = createJsonLogger();
const queueUrl = env("QUEUE_URL");
const sqs = new SQSClient({});
const handler = createSqsHandler({ db: createDb(env("DATABASE_URL")), bank: new SimulatedBank(mode), logger });
logger.info("worker_started", { bank_mode: mode, queue_url: queueUrl });

for (;;) {
  const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 5 }));
  const messages = r.Messages ?? [];
  if (messages.length === 0) continue;
  const res = await handler({
    Records: messages.map((m) => ({ messageId: m.MessageId!, receiptHandle: m.ReceiptHandle!, body: m.Body! })),
  } as SQSEvent);
  const failed = new Set(res.batchItemFailures.map((f) => f.itemIdentifier));
  for (const m of messages) {
    if (!failed.has(m.MessageId!)) await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
  }
}
