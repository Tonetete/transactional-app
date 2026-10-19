import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { ContainerImage } from "aws-cdk-lib/aws-ecs";
import { describe, expect, it } from "vitest";
import { Compute } from "../lib/compute.js";
import { Database } from "../lib/database.js";
import { Messaging } from "../lib/messaging.js";
import { Network } from "../lib/network.js";
import { Settlement } from "../lib/settlement.js";

const CERT = "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000";

function synth(local = false) {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "T", { env: { account: "111111111111", region: "us-east-1" } });
  const net = new Network(stack, "Network");
  const db = new Database(stack, "Database", { vpc: net.vpc });
  const messaging = new Messaging(stack, "Messaging");
  new Settlement(stack, "Settlement", { vpc: net.vpc, queue: messaging.queue, database: db });
  new Compute(stack, "Compute", { vpc: net.vpc, database: db, queue: messaging.queue, certificateArn: CERT, image: ContainerImage.fromRegistry("example/acex-api:test"), local });
  return Template.fromStack(stack);
}

const t = synth();
const tl = synth(true);
const services = () => Object.values(t.findResources("AWS::ECS::Service"));
const taskDefs = () => Object.values(t.findResources("AWS::ECS::TaskDefinition"));
const containerOf = (cmd: "api" | "relay") =>
  taskDefs().map((d) => d.Properties.ContainerDefinitions[0]).find((c) => (cmd === "relay") === Boolean(c.Command))!;

describe("API on Fargate behind an ALB (S3)", () => {
  it("runs at least two Fargate tasks in the private application subnets without public IPs", () => {
    const api = services().find((s) => s.Properties.LoadBalancers)!;
    expect(api.Properties.LaunchType).toBe("FARGATE");
    expect(api.Properties.DesiredCount).toBeGreaterThanOrEqual(2);
    expect(api.Properties.NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp).toBe("DISABLED");
    expect(api.Properties.NetworkConfiguration.AwsvpcConfiguration.Subnets).toHaveLength(2);
  });

  it("has an internet-facing ALB with only an HTTPS:443 listener and a /health check", () => {
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", { Scheme: "internet-facing" });
    const listeners = Object.values(t.findResources("AWS::ElasticLoadBalancingV2::Listener"));
    expect(listeners).toHaveLength(1);
    expect(listeners[0]!.Properties).toMatchObject({ Port: 443, Protocol: "HTTPS" });
    expect(JSON.stringify(listeners[0]!.Properties.Certificates)).toContain(CERT);
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", { HealthCheckPath: "/health", Port: 3000 });
  });

  it("only lets the world reach the ALB on 443, and only the ALB reach the service", () => {
    const sgs = t.findResources("AWS::EC2::SecurityGroup");
    const alb = Object.values(sgs).find((s) => JSON.stringify(s.Properties.GroupDescription).includes("Load balancer"))!;
    const albIngress = alb.Properties.SecurityGroupIngress as { CidrIp?: string; FromPort: number; ToPort: number }[];
    expect(albIngress.length).toBeGreaterThan(0);
    for (const rule of albIngress) expect([rule.FromPort, rule.ToPort]).toEqual([443, 443]);
    const svc = Object.values(sgs).find((s) => JSON.stringify(s.Properties.GroupDescription).includes("API service"))!;
    expect(svc.Properties.SecurityGroupIngress ?? []).toEqual([]);
    const fromAlb = Object.values(t.findResources("AWS::EC2::SecurityGroupIngress")).filter((r) => r.Properties.FromPort === 3000);
    expect(fromAlb.length).toBe(1);
    expect(fromAlb[0]!.Properties.CidrIp).toBeUndefined();
  });
});

describe("Containers, secrets and relay (S2, S5)", () => {
  it("injects database credentials and the JWT secret from Secrets Manager, never as plain values", () => {
    const api = containerOf("api");
    const secretNames = api.Secrets.map((s: { Name: string }) => s.Name).sort();
    expect(secretNames).toEqual(["DB_PASSWORD", "DB_USER", "JWT_SECRET"]);
    const plain = Object.fromEntries(api.Environment.map((e: { Name: string; Value: unknown }) => [e.Name, e.Value]));
    expect(plain).toMatchObject({ DB_NAME: "fintech", PORT: "3000" });
    // the port comes from the instance endpoint (an emulator may not listen on 5432)
    expect(JSON.stringify(plain.DB_PORT)).toContain("Endpoint.Port");
    expect(plain.DB_PASSWORD).toBeUndefined();
    expect(plain.DEV_LOGIN_ENABLED).toBeUndefined();
  });

  it("runs the outbox relay as a separate service with the relay role credentials and the queue URL", () => {
    const relay = containerOf("relay");
    expect(relay.Command.join(" ")).toContain("relay-main");
    expect(relay.Secrets.map((s: { Name: string }) => s.Name).sort()).toEqual(["RELAY_DB_PASSWORD", "RELAY_DB_USER"]);
    expect(relay.Environment.map((e: { Name: string }) => e.Name)).toContain("QUEUE_URL");
    expect(services().length).toBe(2);
  });

  it("lets the application and relay into the database on 5432", () => {
    const ingress = Object.values(t.findResources("AWS::EC2::SecurityGroupIngress")).filter((r) => r.Properties.FromPort === 5432);
    expect(ingress.length).toBeGreaterThanOrEqual(3); // settlement lambda + api + relay
  });
});

describe("Least privilege (S5)", () => {
  it("never grants wildcard actions or admin policies", () => {
    for (const p of Object.values(t.findResources("AWS::IAM::Policy"))) {
      for (const st of p.Properties.PolicyDocument.Statement as { Action: string | string[] }[]) {
        const actions = ([] as string[]).concat(st.Action);
        for (const a of actions) {
          expect(a, JSON.stringify(st)).not.toBe("*");
          expect(a.endsWith(":*"), `${a} in ${JSON.stringify(st)}`).toBe(false);
        }
      }
    }
    for (const r of Object.values(t.findResources("AWS::IAM::Role"))) {
      expect(JSON.stringify(r.Properties.ManagedPolicyArns ?? [])).not.toContain("AdministratorAccess");
    }
  });

  it("limits SQS publishing to the relay task role on the transactions queue only", () => {
    const sendStatements = Object.values(t.findResources("AWS::IAM::Policy")).flatMap((p) =>
      (p.Properties.PolicyDocument.Statement as { Action: string | string[]; Resource: unknown }[]).filter((s) => JSON.stringify(s.Action).includes("sqs:SendMessage")),
    );
    expect(sendStatements).toHaveLength(1);
    expect(JSON.stringify(sendStatements[0]!.Resource)).toContain("MessagingQueue");
    expect(JSON.stringify(sendStatements[0]!.Resource)).not.toContain("Dlq");
  });
});

describe("Local (floci) profile of the API", () => {
  const apiContainer = (tpl: Template) =>
    Object.values(tpl.findResources("AWS::ECS::TaskDefinition")).map((d) => d.Properties.ContainerDefinitions[0]).find((c) => !c.Command)!;

  it("also listens on HTTP:80 (floci does not terminate TLS) and the ALB accepts port 80", () => {
    const ports = Object.values(tl.findResources("AWS::ElasticLoadBalancingV2::Listener")).map((l) => l.Properties.Port as number).sort((a, b) => a - b);
    expect(ports).toEqual([80, 443]);
    const albSg = Object.values(tl.findResources("AWS::EC2::SecurityGroup")).find((s) => JSON.stringify(s.Properties.GroupDescription).includes("Load balancer"))!;
    const albPorts = (albSg.Properties.SecurityGroupIngress as { FromPort: number }[]).map((r) => r.FromPort).sort((a, b) => a - b);
    expect(albPorts).toEqual([80, 443]);
  });

  it("enables the simulated login with an admin credential reference, only in the local profile", () => {
    const local = apiContainer(tl);
    expect(local.Environment.find((e: { Name: string }) => e.Name === "DEV_LOGIN_ENABLED")?.Value).toBe("true");
    expect(local.Secrets.map((s: { Name: string }) => s.Name)).toEqual(expect.arrayContaining(["ADMIN_DB_USER", "ADMIN_DB_PASSWORD"]));
    const prod = apiContainer(t);
    expect(prod.Environment.map((e: { Name: string }) => e.Name)).not.toContain("DEV_LOGIN_ENABLED");
    expect(prod.Secrets.map((s: { Name: string }) => s.Name)).not.toContain("ADMIN_DB_PASSWORD");
  });

  it("keeps the default profile HTTPS-only", () => {
    const listeners = Object.values(t.findResources("AWS::ElasticLoadBalancingV2::Listener"));
    expect(listeners).toHaveLength(1);
  });

  it("points the relay's AWS SDK at the emulator by container name (floci's DNS is unreachable from the task network)", () => {
    const relay = Object.values(tl.findResources("AWS::ECS::TaskDefinition")).map((d) => d.Properties.ContainerDefinitions[0]).find((c) => c.Command)!;
    expect(relay.Environment.find((e: { Name: string }) => e.Name === "AWS_ENDPOINT_URL")?.Value).toBe("http://floci:4566");
    const prodRelay = Object.values(t.findResources("AWS::ECS::TaskDefinition")).map((d) => d.Properties.ContainerDefinitions[0]).find((c) => c.Command)!;
    expect(prodRelay.Environment.map((e: { Name: string }) => e.Name)).not.toContain("AWS_ENDPOINT_URL");
  });
});
