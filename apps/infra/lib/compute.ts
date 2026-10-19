import { Duration } from "aws-cdk-lib";
import { type IVpc, Peer, Port, SecurityGroup, SubnetType } from "aws-cdk-lib/aws-ec2";
import { AwsLogDriver, Cluster, type ContainerImage, FargateService, FargateTaskDefinition, Secret as EcsSecret } from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ListenerCertificate,
  Protocol,
  SslPolicy,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { DB_NAME, DB_PORT, type Database } from "./database.js";

const API_PORT = 3000;

export interface ComputeProps {
  vpc: IVpc;
  database: Database;
  queue: IQueue;
  /** ACM certificate for the ALB HTTPS listener. */
  certificateArn: string;
  /** Image containing the bundled API (dist/main.mjs, dist/relay-main.mjs). */
  image: ContainerImage;
  /** Single web origin allowed by CORS (optional). */
  corsOrigin?: string;
}

/** API (ECS Fargate behind an ALB) and the outbox relay (separate Fargate service). */
export class Compute extends Construct {
  readonly apiService: FargateService;
  readonly relayService: FargateService;
  readonly loadBalancer: ApplicationLoadBalancer;
  readonly jwtSecret: Secret;
  readonly cluster: Cluster;

  constructor(scope: Construct, id: string, { vpc, database, queue, certificateArn, image, corsOrigin }: ComputeProps) {
    super(scope, id);

    const cluster = new Cluster(this, "Cluster", { vpc });
    this.cluster = cluster;
    // HS256 signing key shared with the token issuer (assumption until an identity provider exists).
    this.jwtSecret = new Secret(this, "JwtSecret", { generateSecretString: { excludePunctuation: true, passwordLength: 64 } });

    const dbEnv = { DB_HOST: database.instance.dbInstanceEndpointAddress, DB_PORT: String(DB_PORT), DB_NAME };

    // ---- API ----
    const apiTask = new FargateTaskDefinition(this, "ApiTask", { cpu: 512, memoryLimitMiB: 1024 });
    apiTask.addContainer("api", {
      image,
      portMappings: [{ containerPort: API_PORT }],
      logging: new AwsLogDriver({ streamPrefix: "api", logGroup: new LogGroup(this, "ApiLogs", { retention: RetentionDays.ONE_MONTH }) }),
      environment: { ...dbEnv, PORT: String(API_PORT), ...(corsOrigin ? { CORS_ORIGIN: corsOrigin } : {}) },
      secrets: {
        DB_USER: EcsSecret.fromSecretsManager(database.appUserSecret, "username"),
        DB_PASSWORD: EcsSecret.fromSecretsManager(database.appUserSecret, "password"),
        JWT_SECRET: EcsSecret.fromSecretsManager(this.jwtSecret),
      },
    });

    const apiSg = new SecurityGroup(this, "ApiSecurityGroup", {
      vpc,
      description: "API service: traffic from the load balancer only",
      allowAllOutbound: false,
    });
    apiSg.addEgressRule(Peer.anyIpv4(), Port.tcp(443), "HTTPS (ECR, Secrets Manager, logs)");

    this.apiService = new FargateService(this, "ApiService", {
      cluster,
      taskDefinition: apiTask,
      desiredCount: 2, // spread over the two AZs by the Fargate scheduler
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [apiSg],
      assignPublicIp: false,
      minHealthyPercent: 100,
      healthCheckGracePeriod: Duration.seconds(30),
    });
    this.apiService.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 6 }).scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 60 });

    const albSg = new SecurityGroup(this, "LoadBalancerSecurityGroup", {
      vpc,
      description: "Load balancer: HTTPS from the internet",
      allowAllOutbound: false,
    });
    albSg.addIngressRule(Peer.anyIpv4(), Port.tcp(443), "HTTPS");

    this.loadBalancer = new ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      securityGroup: albSg,
    });
    const listener = this.loadBalancer.addListener("Https", {
      port: 443,
      protocol: ApplicationProtocol.HTTPS,
      certificates: [ListenerCertificate.fromArn(certificateArn)],
      sslPolicy: SslPolicy.RECOMMENDED_TLS,
      open: false,
    });
    listener.addTargets("Api", {
      port: API_PORT,
      protocol: ApplicationProtocol.HTTP,
      targets: [this.apiService],
      healthCheck: { path: "/health", protocol: Protocol.HTTP, interval: Duration.seconds(15), healthyThresholdCount: 2, unhealthyThresholdCount: 3 },
      deregistrationDelay: Duration.seconds(30),
    });

    // ---- Outbox relay ----
    const relayTask = new FargateTaskDefinition(this, "RelayTask", { cpu: 256, memoryLimitMiB: 512 });
    relayTask.addContainer("relay", {
      image,
      command: ["node", "dist/relay-main.mjs"],
      logging: new AwsLogDriver({ streamPrefix: "relay", logGroup: new LogGroup(this, "RelayLogs", { retention: RetentionDays.ONE_MONTH }) }),
      environment: { ...dbEnv, QUEUE_URL: queue.queueUrl },
      secrets: {
        RELAY_DB_USER: EcsSecret.fromSecretsManager(database.relayUserSecret, "username"),
        RELAY_DB_PASSWORD: EcsSecret.fromSecretsManager(database.relayUserSecret, "password"),
      },
    });
    queue.grantSendMessages(relayTask.taskRole);

    const relaySg = new SecurityGroup(this, "RelaySecurityGroup", {
      vpc,
      description: "Outbox relay: no inbound, egress to PostgreSQL and HTTPS",
      allowAllOutbound: false,
    });
    relaySg.addEgressRule(Peer.anyIpv4(), Port.tcp(443), "HTTPS (SQS, ECR, Secrets Manager, logs)");
    this.relayService = new FargateService(this, "RelayService", {
      cluster,
      taskDefinition: relayTask,
      desiredCount: 1, // SKIP LOCKED makes extra replicas safe; one keeps cost lean and ECS replaces a failed task
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [relaySg],
      assignPublicIp: false,
      minHealthyPercent: 100,
    });

    database.allowFrom(this.apiService);
    database.allowFrom(this.relayService);
  }
}
