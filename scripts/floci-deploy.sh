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
if ! aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1; then
  (cd apps/infra && pnpm exec cdk bootstrap "aws://$CDK_DEFAULT_ACCOUNT/$AWS_REGION" -c certificateArn="$CERT" -c target=floci)
fi
cd apps/infra
pnpm exec cdk deploy --all --require-approval never -c certificateArn="$CERT" -c target=floci "$@"
