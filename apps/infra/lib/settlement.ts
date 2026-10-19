import { fileURLToPath } from "node:url";
import { Duration } from "aws-cdk-lib";
import { type IVpc, Peer, Port, SecurityGroup, SubnetType } from "aws-cdk-lib/aws-ec2";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { DB_NAME, type Database } from "./database.js";
import { LOCAL_AWS_ENDPOINT } from "./local.js";
import { SETTLEMENT_TIMEOUT } from "./messaging.js";

export interface SettlementProps {
  vpc: IVpc;
  queue: IQueue;
  database: Database;
  /** Local emulator profile: reach the emulator by container name (see local.ts). */
  local?: boolean;
}

/** SQS-triggered Lambda that settles deposits against the (still simulated) bank. */
export class Settlement extends Construct {
  readonly handler: NodejsFunction;

  constructor(scope: Construct, id: string, { vpc, queue, database, local = false }: SettlementProps) {
    super(scope, id);

    const securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc,
      description: "Settlement Lambda: egress to PostgreSQL and HTTPS (Secrets Manager, bank)",
      allowAllOutbound: false,
    });
    securityGroup.addEgressRule(Peer.anyIpv4(), Port.tcp(443), "HTTPS");

    this.handler = new NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../api/src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: SETTLEMENT_TIMEOUT,
      memorySize: 512,
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [securityGroup],
      // An explicit log group (not the deprecated logRetention custom resource, whose Lambda must call back over HTTPS).
      logGroup: new LogGroup(this, "LogGroup", { retention: RetentionDays.ONE_MONTH }),
      // ESM output: the entry uses top-level await (credentials are loaded at cold start). The banner
      // restores `require` for CommonJS dependencies (pg) inside the ESM bundle.
      bundling: {
        format: OutputFormat.ESM,
        mainFields: ["module", "main"],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        minify: true,
        sourceMap: true,
        target: "node22",
      },
      environment: {
        DB_HOST: database.instance.dbInstanceEndpointAddress,
        DB_PORT: database.instance.dbInstanceEndpointPort,
        DB_NAME,
        DB_SECRET_ARN: database.appUserSecret.secretArn,
        ...(local ? { AWS_ENDPOINT_URL: LOCAL_AWS_ENDPOINT } : {}),
      },
    });

    database.appUserSecret.grantRead(this.handler);
    database.allowFrom(this.handler);
    this.handler.addEventSource(new SqsEventSource(queue, { batchSize: 10, reportBatchItemFailures: true, maxBatchingWindow: Duration.seconds(0) }));
  }
}
