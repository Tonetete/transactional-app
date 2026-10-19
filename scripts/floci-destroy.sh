#!/usr/bin/env bash
# Destroys the Acex stack on floci. The web bucket must be emptied first (CloudFormation cannot delete a non-empty bucket).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/floci-env.sh
BUCKET=$(aws cloudformation describe-stacks --stack-name Acex --query "Stacks[0].Outputs[?contains(OutputKey,'WebBucketName')].OutputValue" --output text 2>/dev/null || true)
if [ -n "$BUCKET" ] && [ "$BUCKET" != "None" ]; then aws s3 rm "s3://$BUCKET" --recursive --only-show-errors || true; fi
cd apps/infra
pnpm exec cdk destroy --force -c certificateArn=unused -c target=floci
