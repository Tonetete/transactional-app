import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { ContainerImage } from "aws-cdk-lib/aws-ecs";
import { describe, expect, it } from "vitest";
import { Compute } from "../lib/compute.js";
import { Database } from "../lib/database.js";
import { Messaging } from "../lib/messaging.js";
import { Network } from "../lib/network.js";
import { Provisioning } from "../lib/provisioning.js";

const CERT = "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000";

const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
const stack = new Stack(app, "T", { env: { account: "111111111111", region: "us-east-1" } });
const net = new Network(stack, "Network");
const db = new Database(stack, "Database", { vpc: net.vpc });
const messaging = new Messaging(stack, "Messaging");
const image = ContainerImage.fromRegistry("example/acex-api:test");
const compute = new Compute(stack, "Compute", { vpc: net.vpc, database: db, queue: messaging.queue, certificateArn: CERT, image });
new Provisioning(stack, "Provisioning", { vpc: net.vpc, database: db, cluster: compute.cluster, image });
const t = Template.fromStack(stack);

const provisionTask = () =>
  Object.values(t.findResources("AWS::ECS::TaskDefinition")).find((d) => JSON.stringify(d.Properties.ContainerDefinitions[0].Command ?? []).includes("provision-main"))!;

describe("Provisioning one-off task", () => {
  it("is a Fargate task definition running provision-main, not a service", () => {
    const def = provisionTask();
    expect(def.Properties.RequiresCompatibilities).toEqual(["FARGATE"]);
    // only the API and the relay are services
    expect(Object.keys(t.findResources("AWS::ECS::Service"))).toHaveLength(2);
  });

  it("receives admin, app and relay credentials as Secrets Manager references and no plain passwords", () => {
    const c = provisionTask().Properties.ContainerDefinitions[0];
    expect(c.Secrets.map((s: { Name: string }) => s.Name).sort()).toEqual([
      "ADMIN_DB_PASSWORD",
      "ADMIN_DB_USER",
      "DB_PASSWORD",
      "DB_USER",
      "RELAY_DB_PASSWORD",
      "RELAY_DB_USER",
    ]);
    const env = c.Environment.map((e: { Name: string }) => e.Name).sort();
    expect(env).toEqual(["DB_HOST", "DB_NAME", "DB_PORT"]);
    const port = c.Environment.find((e: { Name: string }) => e.Name === "DB_PORT").Value;
    expect(JSON.stringify(port)).toContain("Endpoint.Port");
  });

  it("gets its own security group that can reach PostgreSQL but accepts no inbound traffic", () => {
    const sg = Object.entries(t.findResources("AWS::EC2::SecurityGroup")).find(([, s]) => JSON.stringify(s.Properties.GroupDescription).includes("Provisioning"))!;
    expect(sg[1].Properties.SecurityGroupIngress ?? []).toEqual([]);
    const toDb = Object.values(t.findResources("AWS::EC2::SecurityGroupIngress")).filter(
      (r) => r.Properties.FromPort === 5432 && JSON.stringify(r.Properties.SourceSecurityGroupId).includes(sg[0]),
    );
    expect(toDb).toHaveLength(1);
  });

  it("gives the task role no permissions of its own", () => {
    const roleRef = provisionTask().Properties.TaskRoleArn["Fn::GetAtt"][0] as string;
    const policies = Object.values(t.findResources("AWS::IAM::Policy")).filter((p) => JSON.stringify(p.Properties.Roles).includes(roleRef));
    expect(policies).toEqual([]);
  });

  it("prints the exact run-task command as a stack output", () => {
    const outputs = t.toJSON().Outputs as Record<string, { Value: unknown }>;
    const out = Object.entries(outputs).find(([k]) => k.includes("ProvisionCommand"))!;
    const rendered = JSON.stringify(out[1].Value);
    expect(rendered).toContain("aws ecs run-task");
    expect(rendered).toContain("FARGATE");
    expect(rendered).toContain("DISABLED");
  });
});
