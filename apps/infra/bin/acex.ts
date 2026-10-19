import { App, Stack } from "aws-cdk-lib";
import { Database } from "../lib/database.js";
import { Messaging } from "../lib/messaging.js";
import { Network } from "../lib/network.js";
import { Settlement } from "../lib/settlement.js";

// Temporary composition: replaced by the full stack in the compute task.
const app = new App();
const stack = new Stack(app, "Acex", { env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" } });
const net = new Network(stack, "Network");
const db = new Database(stack, "Database", { vpc: net.vpc });
const messaging = new Messaging(stack, "Messaging");
new Settlement(stack, "Settlement", { vpc: net.vpc, queue: messaging.queue, database: db });
