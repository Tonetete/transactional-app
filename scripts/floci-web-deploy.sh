#!/usr/bin/env bash
# Builds the static web app against the deployed API and uploads it to the stack's S3 bucket on floci.
# usage: scripts/floci-web-deploy.sh   (run scripts/floci-deploy.sh first)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/floci-env.sh

output() { aws cloudformation describe-stacks --stack-name Acex --query "Stacks[0].Outputs[?contains(OutputKey,'$1')].OutputValue" --output text; }
BUCKET=$(output WebBucketName)
URL=$(output WebUrl)

# Same origin: CloudFront serves the site and routes /v1/* to the ALB (HTTP listener), so no CORS and no TLS on the ALB.
echo "building apps/web (same-origin API)"
NEXT_PUBLIC_API_URL="" pnpm --filter @acex/web build
echo "uploading to s3://$BUCKET"
aws s3 sync apps/web/out "s3://$BUCKET" --delete --only-show-errors
ID=$(echo "$URL" | sed -E 's#https://([^.]+)\..*#\1#')
echo "site (floci CloudFront emulation): http://$ID.cloudfront.localhost:4566/"
