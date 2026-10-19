#!/usr/bin/env bash
# floci's CloudFormation provisioner drops AllowedMethods / CachePolicyId / OriginRequestPolicyId from CloudFront cache
# behaviors, so the /v1/* behavior would only allow GET and HEAD. This re-applies them with the CloudFront API.
# Idempotent; run after every `cdk deploy` (scripts/floci-deploy.sh does).
set -euo pipefail
source "$(dirname "$0")/floci-env.sh"

DOMAIN_ORIGIN=$(aws cloudformation describe-stacks --stack-name Acex --query "Stacks[0].Outputs[?contains(OutputKey,'WebUrl')].OutputValue" --output text | sed -E 's#https://##')
ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?DomainName=='$DOMAIN_ORIGIN'].Id | [0]" --output text)
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
aws cloudfront get-distribution-config --id "$ID" > "$dir/get.json"
python3 - "$dir" <<'PY'
import json, sys
d = sys.argv[1]
src = json.load(open(f"{d}/get.json"))
cfg = src["DistributionConfig"]
methods = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
for b in (cfg.get("CacheBehaviors") or {}).get("Items", []):
    if b["PathPattern"] == "/v1/*":
        b["AllowedMethods"] = {"Quantity": len(methods), "Items": methods, "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]}}
        b["CachePolicyId"] = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"            # managed CachingDisabled
        b["OriginRequestPolicyId"] = "b689b0a8-53d0-40ab-baf2-68738e2966ac"    # managed AllViewerExceptHostHeader
json.dump(cfg, open(f"{d}/config.json", "w"))
open(f"{d}/etag", "w").write(src["ETag"])
PY
aws cloudfront update-distribution --id "$ID" --if-match "$(cat "$dir/etag")" --distribution-config "file://$dir/config.json" --query 'Distribution.Id' --output text
