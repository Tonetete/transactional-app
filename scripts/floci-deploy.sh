#!/usr/bin/env bash
# Deploys the whole CDK app to floci. usage: scripts/floci-deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/floci-env.sh

# floci can only reach its ECR registry container by name, which needs a user-defined Docker network
# (the default bridge has no name resolution; without this, image pushes fail with 503). Idempotent.
docker network create floci-net >/dev/null 2>&1 || true
docker network connect floci-net floci >/dev/null 2>&1 || true
aws ecr describe-repositories >/dev/null   # lazy-starts the registry container
docker network connect floci-net floci-aws-ecr-registry >/dev/null 2>&1 || true

CERT=$(scripts/floci-cert.sh)
# A half-created toolkit (e.g. after floci was recreated and its registry kept an old repository) must be removed first.
TOOLKIT=$(aws cloudformation describe-stacks --stack-name CDKToolkit --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo NONE)
if [ "$TOOLKIT" = "ROLLBACK_COMPLETE" ] || [ "$TOOLKIT" = "CREATE_FAILED" ]; then
  aws cloudformation delete-stack --stack-name CDKToolkit
  aws ecr delete-repository --repository-name "cdk-hnb659fds-container-assets-$CDK_DEFAULT_ACCOUNT-$AWS_REGION" --force >/dev/null 2>&1 || true
  aws s3 rb "s3://cdk-hnb659fds-assets-$CDK_DEFAULT_ACCOUNT-$AWS_REGION" --force >/dev/null 2>&1 || true
  TOOLKIT=NONE
fi
if [ "$TOOLKIT" = "NONE" ]; then
  (cd apps/infra && pnpm exec cdk bootstrap "aws://$CDK_DEFAULT_ACCOUNT/$AWS_REGION" -c certificateArn="$CERT" -c target=floci)
fi
cd apps/infra
pnpm exec cdk deploy --all --require-approval never -c certificateArn="$CERT" -c target=floci "$@"

# floci's CloudFormation provisioner drops the CloudFront behavior methods/policies: re-apply them.
cd ../..
scripts/floci-patch-cloudfront.sh
