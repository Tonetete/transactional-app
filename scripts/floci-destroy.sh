#!/usr/bin/env bash
# Destroys infra/envs/floci (Terraform) on floci. usage: scripts/floci-destroy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/floci-env.sh
# The image tag does not matter for a destroy, but the certificate ARN is validated, so use the real (idempotent) one.
CERT=$(scripts/floci-cert.sh)
terraform -chdir=infra/envs/floci destroy -auto-approve -input=false -var image_tag=destroy -var "certificate_arn=$CERT"
