import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { WebHosting } from "../lib/web-hosting.js";

function synth(local = false) {
  const stack = new Stack(undefined, "T", { env: { account: "111111111111", region: "us-east-1" } });
  new WebHosting(stack, "Web", { local });
  return Template.fromStack(stack);
}

describe("WebHosting (S2)", () => {
  const t = synth();

  it("stores the static site in a private, encrypted S3 bucket that only accepts TLS", () => {
    t.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] },
    });
    const policies = Object.values(t.findResources("AWS::S3::BucketPolicy"));
    expect(JSON.stringify(policies)).toContain('"aws:SecureTransport":"false"');
  });

  it("serves it through CloudFront with an origin access control, redirecting HTTP to HTTPS", () => {
    t.resourceCountIs("AWS::CloudFront::Distribution", 1);
    t.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    const dist = Object.values(t.findResources("AWS::CloudFront::Distribution"))[0]!.Properties.DistributionConfig;
    expect(dist.DefaultRootObject).toBe("index.html");
    expect(dist.DefaultCacheBehavior.ViewerProtocolPolicy).toBe("redirect-to-https");
    expect(dist.Origins[0].S3OriginConfig.OriginAccessIdentity).toBe("");
    expect(dist.Origins[0].OriginAccessControlId).toBeDefined();
  });

  it("lets only that distribution read the bucket (no public or wildcard principal)", () => {
    const statements = Object.values(t.findResources("AWS::S3::BucketPolicy")).flatMap((p) => p.Properties.PolicyDocument.Statement as Record<string, unknown>[]);
    const read = statements.find((s) => JSON.stringify(s.Action).includes("s3:GetObject"))!;
    expect(read.Principal).toEqual({ Service: "cloudfront.amazonaws.com" });
    expect(JSON.stringify(read.Condition)).toContain("AWS:SourceArn");
  });

  it("serves the exported 404 page for missing objects", () => {
    const dist = Object.values(t.findResources("AWS::CloudFront::Distribution"))[0]!.Properties.DistributionConfig;
    const codes = (dist.CustomErrorResponses as { ErrorCode: number; ResponsePagePath: string }[]).map((e) => [e.ErrorCode, e.ResponsePagePath]);
    expect(codes).toContainEqual([403, "/404.html"]);
    expect(codes).toContainEqual([404, "/404.html"]);
  });

  it("publishes the bucket name and site URL as stack outputs", () => {
    const outputs = Object.keys(t.toJSON().Outputs as Record<string, unknown>);
    expect(outputs.some((o) => o.includes("WebBucketName"))).toBe(true);
    expect(outputs.some((o) => o.includes("WebUrl"))).toBe(true);
  });

  it("is destroyable in the local profile and retained otherwise", () => {
    const bucket = (tpl: Template) => Object.values(tpl.findResources("AWS::S3::Bucket"))[0]!;
    expect(bucket(synth(true)).DeletionPolicy).toBe("Delete");
    expect(bucket(t).DeletionPolicy).toBe("Retain");
  });
});
