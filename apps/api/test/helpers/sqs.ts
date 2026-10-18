import {
  CreateQueueCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from "@aws-sdk/client-sqs";

export const testSqs = () =>
  new SQSClient({
    region: "us-east-1",
    endpoint: process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });

export async function createTestQueue(sqs: SQSClient, attributes?: Record<string, string>) {
  const name = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }));
  return { name, url: QueueUrl!, delete: () => sqs.send(new DeleteQueueCommand({ QueueUrl })) };
}

/** Drains every currently visible message (deleting nothing, visibility timeout set long). */
export async function receiveAll(sqs: SQSClient, queueUrl: string, rounds = 3): Promise<Message[]> {
  const out: Message[] = [];
  for (let i = 0; i < rounds; i++) {
    const r = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        VisibilityTimeout: 300,
        MessageAttributeNames: ["All"],
      }),
    );
    out.push(...(r.Messages ?? []));
  }
  return out;
}

import { DeleteMessageCommand } from "@aws-sdk/client-sqs";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";

/** Stands in for the Lambda event source mapping: one receive, one handler call, delete the successes. */
export async function pollOnce(
  sqs: SQSClient,
  queueUrl: string,
  handler: (e: SQSEvent) => Promise<SQSBatchResponse>,
): Promise<{ received: number; failed: number }> {
  const r = await sqs.send(
    new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1, MessageAttributeNames: ["All"] }),
  );
  const messages = r.Messages ?? [];
  if (messages.length === 0) return { received: 0, failed: 0 };
  const res = await handler({
    Records: messages.map((m) => ({ messageId: m.MessageId!, receiptHandle: m.ReceiptHandle!, body: m.Body! })),
  } as SQSEvent);
  const failed = new Set(res.batchItemFailures.map((f) => f.itemIdentifier));
  for (const m of messages) {
    if (!failed.has(m.MessageId!)) await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
  }
  return { received: messages.length, failed: failed.size };
}
