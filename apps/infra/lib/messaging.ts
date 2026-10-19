import { Duration } from "aws-cdk-lib";
import { DeadLetterQueue, Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

/** After this many failed receives a message moves to the DLQ (specs/02: "3 reintentos"). */
export const MAX_RECEIVE_COUNT = 3;
/** Settlement Lambda timeout; the queue visibility timeout is derived from it. */
export const SETTLEMENT_TIMEOUT = Duration.seconds(30);

export class Messaging extends Construct {
  readonly queue: Queue;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.dlq = new Queue(this, "Dlq", {
      queueName: "TransactionsDLQ",
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14), // kept for manual audit
    });
    const deadLetterQueue: DeadLetterQueue = { queue: this.dlq, maxReceiveCount: MAX_RECEIVE_COUNT };
    this.queue = new Queue(this, "Queue", {
      queueName: "TransactionsQueue",
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      // AWS guidance for Lambda consumers: at least 6x the function timeout, so a slow bank call is not redelivered mid-flight.
      visibilityTimeout: Duration.seconds(SETTLEMENT_TIMEOUT.toSeconds() * 6),
      deadLetterQueue,
    });
  }
}
