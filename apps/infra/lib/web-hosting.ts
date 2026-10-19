import { CfnOutput, RemovalPolicy } from "aws-cdk-lib";
import { Distribution, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface WebHostingProps {
  /** Local emulator profile: the bucket can be destroyed with the stack. */
  local?: boolean;
}

/**
 * Hosting for the statically exported Next.js app: a private S3 bucket behind CloudFront (origin access
 * control). Content is uploaded out of band (scripts/floci-web-deploy.sh), not by a custom resource.
 */
export class WebHosting extends Construct {
  readonly bucket: Bucket;
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, { local = false }: WebHostingProps = {}) {
    super(scope, id);

    this.bucket = new Bucket(this, "Bucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: local ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    this.distribution = new Distribution(this, "Distribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      // A private bucket answers 403 for a missing key; show the exported 404 page for both.
      errorResponses: [403, 404].map((httpStatus) => ({ httpStatus, responseHttpStatus: 404, responsePagePath: "/404.html" })),
    });

    new CfnOutput(this, "WebBucketName", { value: this.bucket.bucketName });
    new CfnOutput(this, "WebUrl", { value: `https://${this.distribution.distributionDomainName}` });
  }
}
