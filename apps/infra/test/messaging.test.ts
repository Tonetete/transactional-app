import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { Database } from "../lib/database.js";
import { Messaging } from "../lib/messaging.js";
import { Network } from "../lib/network.js";
import { Settlement } from "../lib/settlement.js";

function synth() {
  // Skip esbuild bundling: these tests assert the template, not the artifact.
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "T", { env: { account: "111111111111", region: "us-east-1" } });
  const net = new Network(stack, "Network");
  const db = new Database(stack, "Database", { vpc: net.vpc });
  const messaging = new Messaging(stack, "Messaging");
  const settlement = new Settlement(stack, "Settlement", { vpc: net.vpc, queue: messaging.queue, database: db });
  return { t: Template.fromStack(stack), messaging, settlement };
}

describe("Messaging (S4)", () => {
  const { t } = synth();
  const queues = () => Object.values(t.findResources("AWS::SQS::Queue"));

  it("creates TransactionsDLQ and a main queue that redrives to it after 3 receives", () => {
    t.hasResourceProperties("AWS::SQS::Queue", { QueueName: "TransactionsDLQ" });
    const main = queues().find((q) => q.Properties.RedrivePolicy)!;
    expect(main.Properties.RedrivePolicy.maxReceiveCount).toBe(3);
    expect(JSON.stringify(main.Properties.RedrivePolicy.deadLetterTargetArn)).toContain("Arn");
  });

  it("encrypts both queues and keeps failed messages for 14 days", () => {
    for (const q of queues()) expect(q.Properties.SqsManagedSseEnabled).toBe(true);
    const dlq = queues().find((q) => q.Properties.QueueName === "TransactionsDLQ")!;
    expect(dlq.Properties.MessageRetentionPeriod).toBe(14 * 24 * 3600);
  });

  it("refuses non-TLS access to the queues", () => {
    const policies = Object.values(t.findResources("AWS::SQS::QueuePolicy"));
    expect(policies.length).toBe(2);
    for (const p of policies) expect(JSON.stringify(p.Properties.PolicyDocument)).toContain('"aws:SecureTransport":"false"');
  });
});

describe("Settlement Lambda (S4, S2)", () => {
  const { t } = synth();

  it("consumes the queue with partial batch failure reporting", () => {
    t.hasResourceProperties("AWS::Lambda::EventSourceMapping", { FunctionResponseTypes: ["ReportBatchItemFailures"], BatchSize: 10 });
  });

  it("gives the queue a visibility timeout of at least 6x the function timeout", () => {
    const fn = Object.values(t.findResources("AWS::Lambda::Function")).find((f) => f.Properties.Handler?.includes("handler"))!;
    const main = Object.values(t.findResources("AWS::SQS::Queue")).find((q) => q.Properties.RedrivePolicy)!;
    expect(main.Properties.VisibilityTimeout).toBeGreaterThanOrEqual(fn.Properties.Timeout * 6);
  });

  it("runs in the private application subnets and receives the database secret ARN, never the password", () => {
    const fn = Object.values(t.findResources("AWS::Lambda::Function")).find((f) => f.Properties.Handler?.includes("handler"))!;
    expect(fn.Properties.VpcConfig.SubnetIds).toHaveLength(2);
    const env = fn.Properties.Environment.Variables;
    expect(env.DB_NAME).toBe("fintech");
    expect(JSON.stringify(env.DB_PORT)).toContain("Endpoint.Port");
    expect(env.DB_SECRET_ARN).toBeDefined();
    expect(JSON.stringify(env)).not.toContain("resolve:secretsmanager");
    expect(env.DB_PASSWORD).toBeUndefined();
  });

  it("is allowed into the database security group on 5432", () => {
    t.hasResourceProperties("AWS::EC2::SecurityGroupIngress", { FromPort: 5432, ToPort: 5432 });
  });
});
