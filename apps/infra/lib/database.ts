import { Duration } from "aws-cdk-lib";
import { type IConnectable, type IVpc, Port, SecurityGroup, SubnetType, InstanceClass, InstanceSize, InstanceType } from "aws-cdk-lib/aws-ec2";
import { Credentials, DatabaseInstance, DatabaseInstanceEngine, PostgresEngineVersion } from "aws-cdk-lib/aws-rds";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export const DB_NAME = "fintech";
export const DB_PORT = 5432;

export interface DatabaseProps {
  vpc: IVpc;
}

/** Multi-AZ encrypted PostgreSQL in the isolated subnets; credentials only live in Secrets Manager. */
export class Database extends Construct {
  readonly instance: DatabaseInstance;
  /** Master credentials (administration and migrations only). */
  readonly adminSecret: Secret;
  /** Credentials of the RLS-subject `app_user` role (API and settlement Lambda). */
  readonly appUserSecret: Secret;
  /** Credentials of the `outbox_relay` role. */
  readonly relayUserSecret: Secret;
  private readonly securityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, { vpc }: DatabaseProps) {
    super(scope, id);

    // No egress at all: the database never initiates connections.
    this.securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc,
      description: "Database: PostgreSQL from authorized application security groups only",
      allowAllOutbound: false,
    });

    this.adminSecret = new Secret(this, "AdminSecret", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "root" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32,
      },
    });
    this.appUserSecret = this.roleSecret("AppUserSecret", "app_user");
    this.relayUserSecret = this.roleSecret("RelayUserSecret", "outbox_relay");

    this.instance = new DatabaseInstance(this, "Instance", {
      engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_16 }),
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MEDIUM),
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.securityGroup],
      multiAz: true,
      storageEncrypted: true,
      publiclyAccessible: false,
      databaseName: DB_NAME,
      credentials: Credentials.fromSecret(this.adminSecret),
      allocatedStorage: 50,
      backupRetention: Duration.days(7),
      deletionProtection: true,
    });
  }

  /** Allows PostgreSQL connections from the given application component (ECS service, Lambda...). */
  allowFrom(client: IConnectable): void {
    this.securityGroup.connections.allowFrom(client, Port.tcp(DB_PORT), "PostgreSQL from application");
  }

  private roleSecret(id: string, username: string): Secret {
    return new Secret(this, id, {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32,
      },
    });
  }
}
