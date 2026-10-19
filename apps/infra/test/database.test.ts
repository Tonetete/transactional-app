import { Stack } from "aws-cdk-lib";
import { SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { Database } from "../lib/database.js";
import { Network } from "../lib/network.js";

function synth() {
  const stack = new Stack(undefined, "T", { env: { account: "111111111111", region: "us-east-1" } });
  const net = new Network(stack, "Network");
  const db = new Database(stack, "Database", { vpc: net.vpc });
  const app = new SecurityGroup(stack, "AppSg", { vpc: net.vpc });
  db.allowFrom(app);
  return { stack, db, app, t: Template.fromStack(stack) };
}

describe("Database (S2)", () => {
  const { t, db } = synth();

  it("is a Multi-AZ, encrypted PostgreSQL instance in the isolated subnets, not publicly accessible", () => {
    t.hasResourceProperties("AWS::RDS::DBInstance", {
      Engine: "postgres",
      MultiAZ: true,
      StorageEncrypted: true,
      PubliclyAccessible: false,
      DeletionProtection: true,
    });
    const subnetGroup = Object.values(t.findResources("AWS::RDS::DBSubnetGroup"))[0]!;
    const ids = (subnetGroup.Properties.SubnetIds as { Ref: string }[]).map((r) => r.Ref);
    const isolated = Object.entries(t.findResources("AWS::EC2::Subnet"))
      .filter(([, s]) => JSON.stringify(s.Properties.Tags).includes('"Isolated"'))
      .map(([id]) => id);
    expect(ids.sort()).toEqual(isolated.sort());
  });

  it("keeps credentials in Secrets Manager: no plaintext password on the instance", () => {
    const instance = Object.values(t.findResources("AWS::RDS::DBInstance"))[0]!;
    expect(JSON.stringify(instance.Properties.MasterUserPassword)).toContain("resolve:secretsmanager");
    t.hasResourceProperties("AWS::SecretsManager::Secret", { GenerateSecretString: Match.objectLike({ GenerateStringKey: "password" }) });
  });

  it("creates dedicated secrets for the application and outbox-relay database roles", () => {
    const names = Object.values(t.findResources("AWS::SecretsManager::Secret")).map((s) => String(s.Properties.GenerateSecretString.SecretStringTemplate));
    expect(names.some((n) => n.includes('"username":"app_user"'))).toBe(true);
    expect(names.some((n) => n.includes('"username":"outbox_relay"'))).toBe(true);
    expect(db.appUserSecret).toBeDefined();
    expect(db.relayUserSecret).toBeDefined();
  });

  it("accepts PostgreSQL traffic only from the allowed security group and has no other ingress or egress", () => {
    const ingress = Object.values(t.findResources("AWS::EC2::SecurityGroupIngress"));
    expect(ingress).toHaveLength(1);
    expect(ingress[0]!.Properties).toMatchObject({ IpProtocol: "tcp", FromPort: 5432, ToPort: 5432 });
    expect(ingress[0]!.Properties.CidrIp).toBeUndefined();
    const sgs = Object.values(t.findResources("AWS::EC2::SecurityGroup"));
    const dbSg = sgs.find((s) => JSON.stringify(s.Properties.GroupDescription).includes("Database"))!;
    expect(JSON.stringify(dbSg.Properties.SecurityGroupIngress ?? [])).not.toContain("0.0.0.0/0");
    expect(JSON.stringify(dbSg.Properties.SecurityGroupEgress ?? [])).not.toContain("0.0.0.0/0");
  });
});

describe("Database in the local (floci) profile", () => {
  it("is destroyable: no deletion protection and DESTROY removal, but still Multi-AZ and encrypted", () => {
    const stack = new Stack(undefined, "L", { env: { account: "111111111111", region: "us-east-1" } });
    new Database(stack, "Database", { vpc: new Network(stack, "Network").vpc, local: true });
    const t = Template.fromStack(stack);
    t.hasResourceProperties("AWS::RDS::DBInstance", { DeletionProtection: false, MultiAZ: true, StorageEncrypted: true });
    const instance = Object.values(t.findResources("AWS::RDS::DBInstance"))[0]!;
    expect(instance.DeletionPolicy).toBe("Delete");
  });

  it("keeps deletion protection and a snapshot on delete by default", () => {
    const instance = Object.values(synth().t.findResources("AWS::RDS::DBInstance"))[0]!;
    expect(instance.DeletionPolicy).toBe("Snapshot");
  });
});
