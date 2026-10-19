import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

/** Three-tier, multi-AZ VPC: public (ALB, NAT), private application, and isolated data subnets. */
export class Network extends Construct {
  readonly vpc: Vpc;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.vpc = new Vpc(this, "Vpc", {
      maxAzs: 2,
      // One NAT per AZ: an AZ outage must not cut outbound traffic of the other one.
      natGateways: 2,
      subnetConfiguration: [
        { name: "Public", subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        { name: "Private", subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "Isolated", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
  }
}
