import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { Network } from "../lib/network.js";

function synth() {
  const stack = new Stack(undefined, "T", { env: { account: "111111111111", region: "us-east-1" } });
  new Network(stack, "Network");
  return Template.fromStack(stack);
}

describe("Network (S1)", () => {
  const t = synth();

  it("creates one VPC spanning at least two AZs with public, private-app and isolated-data subnets in each", () => {
    t.resourceCountIs("AWS::EC2::VPC", 1);
    const subnets = Object.values(t.findResources("AWS::EC2::Subnet"));
    const azs = new Set(subnets.map((s) => JSON.stringify(s.Properties.AvailabilityZone)));
    expect(azs.size).toBeGreaterThanOrEqual(2);
    for (const type of ["Public", "Private", "Isolated"]) {
      const tier = subnets.filter((s) => s.Properties.Tags.some((tag: { Key: string; Value: string }) => tag.Key === "aws-cdk:subnet-name" && tag.Value === type));
      expect(tier.length, type).toBe(azs.size);
    }
  });

  it("gives public subnets an internet gateway and NAT, private ones a NAT route, isolated ones no default route", () => {
    t.resourceCountIs("AWS::EC2::InternetGateway", 1);
    expect(Object.keys(t.findResources("AWS::EC2::NatGateway")).length).toBeGreaterThanOrEqual(2);
    const routes = Object.values(t.findResources("AWS::EC2::Route"));
    const defaults = routes.filter((r) => r.Properties.DestinationCidrBlock === "0.0.0.0/0");
    expect(defaults.some((r) => r.Properties.GatewayId)).toBe(true);
    expect(defaults.some((r) => r.Properties.NatGatewayId)).toBe(true);

    const isolatedTables = Object.entries(t.findResources("AWS::EC2::RouteTable")).filter(([, r]) =>
      JSON.stringify(r.Properties.Tags).includes("Isolated"),
    );
    expect(isolatedTables.length).toBeGreaterThanOrEqual(2);
    for (const [id] of isolatedTables) {
      const hasDefault = defaults.some((r) => JSON.stringify(r.Properties.RouteTableId) === JSON.stringify({ Ref: id }));
      expect(hasDefault, `isolated table ${id}`).toBe(false);
    }
  });

  it("exposes the three subnet tiers to other constructs", () => {
    const stack = new Stack(undefined, "T2", { env: { account: "111111111111", region: "us-east-1" } });
    const net = new Network(stack, "Network");
    expect(net.vpc.publicSubnets.length).toBeGreaterThanOrEqual(2);
    expect(net.vpc.privateSubnets.length).toBeGreaterThanOrEqual(2);
    expect(net.vpc.isolatedSubnets.length).toBeGreaterThanOrEqual(2);
  });
});
