#!/usr/bin/env bash
# End-to-end check of the stack deployed to floci: tenant -> JWT -> deposit -> relay -> SQS -> Lambda -> SETTLED.
# The ALB listener (443) is not published by the floci container, so the API task container is called directly.
# usage: [IAC=terraform] scripts/floci-smoke.sh [tenant] [user]   (IAC=cdk, the default, targets the CDK stack)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/floci-env.sh
TENANT="${1:-tnt_cloud}"; USER_ID="${2:-usr_cloud}"
IAC="${IAC:-cdk}"
if [ "$IAC" = terraform ]; then
  ADMIN_SECRET=acex-floci/database/admin; JWT_SECRET_NAME=acex-floci/api/jwt; DB_FILTER="starts_with(DBInstanceIdentifier,'acex-floci-')"
else
  ADMIN_SECRET=AdminSecret; JWT_SECRET_NAME=JwtSecret; DB_FILTER="starts_with(DBInstanceIdentifier,'acex-') && !starts_with(DBInstanceIdentifier,'acex-floci-')"
fi
secret() { aws secretsmanager get-secret-value --secret-id "$1" --query SecretString --output text; }
arn_of() { aws secretsmanager list-secrets --query "SecretList[?contains(Name,'$1')].ARN | [0]" --output text; }
field() { python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }

read -r DB_HOST DB_PORT < <(aws rds describe-db-instances --query "DBInstances[?$DB_FILTER].[Endpoint.Address,Endpoint.Port] | [0]" --output text)
ADMIN_PW=$(secret "$(arn_of "$ADMIN_SECRET")" | field password)
JWT=$(secret "$(arn_of "$JWT_SECRET_NAME")")

echo "1. tenant $TENANT"
docker run --rm --network floci-net -e PGPASSWORD="$ADMIN_PW" postgres:16-alpine \
  psql -h "$DB_HOST" -p "$DB_PORT" -U root -d fintech -q -c "insert into tenants (id, name) values ('$TENANT', '$TENANT') on conflict (id) do nothing"

echo "2. token"
TOKEN=$(JWT_SECRET="$JWT" pnpm -s --filter @acex/api dev:token "$TENANT" "$USER_ID")

if [ "$IAC" = terraform ]; then
  TASK_ID=$(aws ecs list-tasks --cluster acex-floci --service-name api --query 'taskArns[0]' --output text | sed 's#.*/##')
  API_CONTAINER="floci-aws-ecs-$TASK_ID-api"   # floci names the container after the task id
else
  CDK_CLUSTER=$(aws ecs list-clusters --query 'clusterArns[?contains(@, `:cluster/Acex-`)] | [0]' --output text)
  TASK_ID=$(aws ecs list-tasks --cluster "$CDK_CLUSTER" --query 'taskArns' --output text | tr '\t' '\n' | sed 's#.*/##' | while read -r id; do
    docker inspect "floci-aws-ecs-$id-api" >/dev/null 2>&1 && { echo "$id"; break; }; done)
  API_CONTAINER="floci-aws-ecs-$TASK_ID-api"
fi
# The emulated database and the task containers sit on floci-net (created by the deploy scripts): join it, or the
# addresses are unreachable from a throwaway container on the default bridge.
read -r API_NET API_IP < <(docker inspect "$API_CONTAINER" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{$v.IPAddress}}{{"\n"}}{{end}}' | head -1)
call() { docker run --rm --network "$API_NET" curlimages/curl -s -m 15 "$@"; }

KEY="smoke_$(date +%s)"
echo "3. deposit via $API_CONTAINER ($API_IP)"
call -X POST "http://$API_IP:3000/v1/deposits" -H "authorization: Bearer $TOKEN" -H "idempotency-key: $KEY" -H "content-type: application/json" \
  -d '{"amount_cents":5000000,"currency":"USD","source_account":{"holder_name":"Jane Doe","iban":"GB82WEST12345698765432"}}'
echo

echo "4. waiting for settlement"
for i in $(seq 1 30); do
  STATUS=$(call "http://$API_IP:3000/v1/deposits" -H "authorization: Bearer $TOKEN" | python3 -c "import json,sys; i=json.load(sys.stdin)['items']; print(i[0]['status'] if i else 'NONE')")
  echo "   $STATUS"
  [ "$STATUS" = "SETTLED" ] && { echo "OK: deposit settled end to end"; exit 0; }
  [ "$STATUS" = "FAILED" ] && { echo "FAILED"; exit 1; }
  sleep 3
done
echo "TIMEOUT: still $STATUS (check relay and Lambda logs)"; exit 1
