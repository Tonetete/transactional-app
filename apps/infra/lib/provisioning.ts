import { CfnOutput, Fn, Stack } from "aws-cdk-lib";
import { type IVpc, Peer, Port, SecurityGroup, SubnetType } from "aws-cdk-lib/aws-ec2";
import { AwsLogDriver, type ICluster, type ContainerImage, FargateTaskDefinition, Secret as EcsSecret } from "aws-cdk-lib/aws-ecs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { DB_NAME, type Database } from "./database.js";

export interface ProvisioningProps {
  vpc: IVpc;
  database: Database;
  cluster: ICluster;
  image: ContainerImage;
}

/**
 * One-off task (not a service): applies migrations with the admin role and sets the app_user / outbox_relay
 * passwords from their secrets. Run it with the command in the `ProvisionCommand` stack output, after the
 * first deploy and after any deploy that adds migrations or rotates a database secret.
 */
export class Provisioning extends Construct {
  readonly taskDefinition: FargateTaskDefinition;
  readonly securityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, { vpc, database, cluster, image }: ProvisioningProps) {
    super(scope, id);

    // The task role stays empty: secrets are injected by the execution role, and the task only talks to PostgreSQL.
    this.taskDefinition = new FargateTaskDefinition(this, "Task", { cpu: 256, memoryLimitMiB: 512 });
    this.taskDefinition.addContainer("provision", {
      image,
      command: ["node", "dist/provision-main.mjs"],
      logging: new AwsLogDriver({ streamPrefix: "provision", logGroup: new LogGroup(this, "ProvisionLogs", { retention: RetentionDays.ONE_MONTH }) }),
      environment: { DB_HOST: database.instance.dbInstanceEndpointAddress, DB_PORT: database.instance.dbInstanceEndpointPort, DB_NAME },
      secrets: {
        ADMIN_DB_USER: EcsSecret.fromSecretsManager(database.adminSecret, "username"),
        ADMIN_DB_PASSWORD: EcsSecret.fromSecretsManager(database.adminSecret, "password"),
        DB_USER: EcsSecret.fromSecretsManager(database.appUserSecret, "username"),
        DB_PASSWORD: EcsSecret.fromSecretsManager(database.appUserSecret, "password"),
        RELAY_DB_USER: EcsSecret.fromSecretsManager(database.relayUserSecret, "username"),
        RELAY_DB_PASSWORD: EcsSecret.fromSecretsManager(database.relayUserSecret, "password"),
      },
    });

    this.securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc,
      description: "Provisioning task: egress to PostgreSQL and HTTPS only, no inbound",
      allowAllOutbound: false,
    });
    this.securityGroup.addEgressRule(Peer.anyIpv4(), Port.tcp(443), "HTTPS (ECR, Secrets Manager, logs)");
    database.allowFrom(this.securityGroup);

    const subnets = Fn.join(",", vpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS }).subnetIds);
    new CfnOutput(this, "ProvisionCommand", {
      description: "Run once after deploy (and after migrations or secret rotation); follow the logs in CloudWatch /provision",
      value:
        `aws ecs run-task --cluster ${cluster.clusterName} --launch-type FARGATE --task-definition ${this.taskDefinition.taskDefinitionArn} ` +
        `--network-configuration "awsvpcConfiguration={subnets=[${subnets}],securityGroups=[${this.securityGroup.securityGroupId}],assignPublicIp=DISABLED}" ` +
        `--region ${Stack.of(this).region}`,
    });
  }
}
