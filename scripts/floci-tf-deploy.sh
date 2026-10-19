#!/usr/bin/env bash
# Deploys infra/envs/floci (Terraform) to floci: registry, image build+push, everything else, then runs the provisioning
# task (migrations + role passwords). usage: scripts/floci-tf-deploy.sh [extra terraform apply args]
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
pnpm --filter @acex/api bundle:lambda >/dev/null

TF=(terraform -chdir=infra/envs/floci)
"${TF[@]}" init -input=false >/dev/null
VARS=(-input=false -var "certificate_arn=$CERT")

# 1. The registry first, so the image exists before the services that run it.
"${TF[@]}" apply -auto-approve "${VARS[@]}" -var image_tag=pending -target=module.registry >/dev/null
REPO=$("${TF[@]}" output -raw repository_url)
TAG=$(git rev-parse --short=12 HEAD)
git diff --quiet HEAD -- apps/api packages || TAG="$TAG-$(date +%s)"   # uncommitted changes: do not reuse the tag

# 2. Build and push.
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}" >/dev/null
docker build -f apps/api/Dockerfile -t "$REPO:$TAG" . >/dev/null
docker push "$REPO:$TAG" >/dev/null
echo "image: $REPO:$TAG"

# 3. Everything else.
"${TF[@]}" apply -auto-approve "${VARS[@]}" -var "image_tag=$TAG" "$@"

# 4. Provisioning task: wait for it and fail loudly if it did not exit 0.
CLUSTER=$("${TF[@]}" output -raw cluster_name)
TASK=$(eval "$("${TF[@]}" output -raw provision_command) --query 'tasks[0].taskArn' --output text")
echo "provisioning task: $TASK"
for _ in $(seq 1 60); do
  STATUS=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].lastStatus' --output text)
  [ "$STATUS" = "STOPPED" ] && break
  sleep 5
done
CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
[ "$STATUS" = "STOPPED" ] && [ "$CODE" = "0" ] || { echo "provisioning failed (status $STATUS, exit code $CODE); see CloudWatch /acex-floci/provision" >&2; exit 1; }
echo "provisioned: migrations applied and role passwords set"
