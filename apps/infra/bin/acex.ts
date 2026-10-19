import { fileURLToPath } from "node:url";
import { App, Stack } from "aws-cdk-lib";
import { ContainerImage } from "aws-cdk-lib/aws-ecs";
import { Compute } from "../lib/compute.js";
import { Database } from "../lib/database.js";
import { Messaging } from "../lib/messaging.js";
import { Network } from "../lib/network.js";
import { Provisioning } from "../lib/provisioning.js";
import { Settlement } from "../lib/settlement.js";

const app = new App();
const certificateArn = app.node.tryGetContext("certificateArn") as string | undefined;
if (!certificateArn) throw new Error("Pass the ALB certificate: cdk synth -c certificateArn=arn:aws:acm:...");

const stack = new Stack(app, "Acex", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" },
});
const network = new Network(stack, "Network");
const database = new Database(stack, "Database", { vpc: network.vpc });
const messaging = new Messaging(stack, "Messaging");
new Settlement(stack, "Settlement", { vpc: network.vpc, queue: messaging.queue, database });
const image = ContainerImage.fromAsset(fileURLToPath(new URL("../../..", import.meta.url)), { file: "apps/api/Dockerfile" });
const compute = new Compute(stack, "Compute", {
  vpc: network.vpc,
  database,
  queue: messaging.queue,
  certificateArn,
  corsOrigin: app.node.tryGetContext("corsOrigin") as string | undefined,
  image,
});
new Provisioning(stack, "Provisioning", { vpc: network.vpc, database, cluster: compute.cluster, image });
