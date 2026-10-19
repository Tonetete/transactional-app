#!/usr/bin/env bash
# Imports a self-signed certificate into floci ACM (once) and prints its ARN. The ALB HTTPS listener needs one.
set -euo pipefail
source "$(dirname "$0")/floci-env.sh"
DOMAIN="${1:-acex.local}"
arn=$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='$DOMAIN'].CertificateArn | [0]" --output text)
if [ "$arn" = "None" ] || [ -z "$arn" ]; then
  dir=$(mktemp -d)
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=$DOMAIN" -keyout "$dir/key.pem" -out "$dir/cert.pem" 2>/dev/null
  arn=$(aws acm import-certificate --certificate "fileb://$dir/cert.pem" --private-key "fileb://$dir/key.pem" --query CertificateArn --output text)
  rm -rf "$dir"
fi
echo "$arn"
