# Local development against floci

floci (AWS emulator) provides RDS PostgreSQL and SQS. Its RDS proxy (`172.17.0.2:7001`) is only reachable
inside Docker, so a small TCP forward exposes it on the host.

## One-time setup
```bash
# 1. Forward floci's RDS endpoint to localhost:5433
docker run -d --name floci-rds-forward -p 5433:5432 alpine/socat \
  tcp-listen:5432,fork,reuseaddr tcp-connect:172.17.0.2:7001

# 2. Configure env (the real .env is git-ignored; set the RDS master password in ADMIN_DATABASE_URL)
cp .env.example .env

# 3. Migrate, create roles app_user/outbox_relay, seed tenants tnt_abc/tnt_xyz, create queue + DLQ
pnpm --filter @acex/api dev:setup
```
`root` is a superuser and bypasses RLS: it is only used by `dev:setup`. The API and worker connect as `app_user`.

## Run (three terminals)
```bash
pnpm --filter @acex/api dev          # API on :3000
pnpm --filter @acex/api dev:relay    # outbox -> SQS
pnpm --filter @acex/api dev:worker   # SQS -> settlement (BANK_MODE=clear|reject|down in .env)
```

## Web app (apps/web)
Set in `.env` (see `.env.example`): `DEV_LOGIN_ENABLED=true` and `CORS_ORIGIN=http://localhost:3001`, then restart the API.
```bash
pnpm --filter @acex/web dev          # http://localhost:3001 (API url: NEXT_PUBLIC_API_URL, default http://localhost:3000)
```
Sign in with any tenant/user id (simulated login, `POST /v1/auth/dev-login`; it provisions the tenant and mints a dev JWT,
so it exists only when `DEV_LOGIN_ENABLED=true` and must never be enabled outside local development). Then request a
deposit; the list polls `GET /v1/deposits` every 3 s, so you see `PENDING` turn into `SETTLED`/`FAILED` while the relay and worker run.
Components follow atomic design: see `apps/web/src/components/README.md`.

## Deploy the whole stack to floci (CDK)
Instead of running the API, relay and worker as local processes, `apps/infra` can deploy everything to floci:
VPC, RDS, SQS + DLQ, settlement Lambda, ECS (API x2, relay), ALB and the web hosting (S3 + CloudFront).
```bash
scripts/floci-deploy.sh        # bootstrap (once), import a self-signed ACM cert, build+push the image, cdk deploy
# run the provisioning task printed in the stack output `ProvisionCommand` (migrations + role passwords):
source scripts/floci-env.sh
eval "$(aws cloudformation describe-stacks --stack-name Acex --query "Stacks[0].Outputs[?contains(OutputKey,'ProvisionCommand')].OutputValue" --output text)"
scripts/floci-smoke.sh         # tenant -> JWT -> deposit -> relay -> SQS -> Lambda -> SETTLED
scripts/floci-web-deploy.sh    # static build of apps/web -> S3; prints the CloudFront URL served by floci
scripts/floci-destroy.sh       # empties the web bucket, then cdk destroy
```
Verified on floci 2.3.0: a from-scratch cycle (destroy, deploy, provision, smoke, web deploy) passes. Things to know:
- **Both modes can coexist.** Local dev uses `transactions-queue` / `transactions-dlq`; the stack uses `TransactionsQueue` /
  `TransactionsDLQ`. (If your `.env` still has `DLQ_NAME=TransactionsDLQ`, change it: `dev:setup` and the stack would
  fight over that name.) Destroying the stack does not touch the dev queues.
- **ECR needs a user-defined network.** floci reaches its registry container by name, which the default bridge cannot
  resolve (image push fails with `503`). `scripts/floci-deploy.sh` connects `floci` and `floci-aws-ecr-registry` to a `floci-net` network.
- **Not reachable from the host:** the ALB listener (443) and the ECS task containers are not published by the floci
  container (it only publishes 4566), so `floci-smoke.sh` calls the API task container through the Docker bridge.
  To use the ALB or the deployed web against the deployed API from a browser, recreate floci publishing the listener port.
- **No `logRetention`:** that CDK feature is a custom-resource Lambda that calls back over HTTPS, which fails on floci;
  log groups are declared explicitly instead.
- The RDS endpoint port is whatever floci assigns (7001+), so containers use the instance endpoint port, not 5432.
- SQS queue URLs from floci point at `localhost:4566`; the relay resolves its SQS endpoint from the environment instead.
- Tenants are not seeded in the stack (`floci-smoke.sh` inserts its own); the login route is not enabled in the deployed API.

## Try it
Easiest: `scripts/deposit.sh [idempotency_key] [amount_cents] [tenant] [user]` (no multi-line pasting).

Or by hand:
```bash
TOKEN=$(pnpm -s --filter @acex/api dev:token tnt_abc usr_123)
curl -i -X POST localhost:3000/v1/deposits \
  -H "authorization: Bearer $TOKEN" -H "idempotency-key: idk_001" -H "x-correlation-id: corr-001" \
  -H "content-type: application/json" \
  -d '{"amount_cents":5000000,"currency":"USD","source_account":{"holder_name":"Jane Doe","iban":"GB82WEST12345698765432"}}'
# 202 PENDING; repeat the same call -> 200 with the same transaction_id (status becomes SETTLED once the worker ran)
```
Amounts are integer cents (`5000000` = $50,000.00). Follow one deposit through the logs with `grep corr-001`.
Set `BANK_MODE=down` and restart the worker to watch retries and the DLQ (`transactions-dlq`).

## Notes
- After pulling new migrations, re-run `pnpm --filter @acex/api dev:setup` (idempotent).
- Settled funds are recorded in the append-only `ledger_entries` table (one `CREDIT` per settled transaction);
  `accounts.balance_cents` always equals the sum of its entries. `UPDATE`/`DELETE` on it are blocked, even for `root`.
- `X-Tenant-Id` is optional; if sent it must equal the tenant in the JWT, otherwise `403 TENANT_MISMATCH`.
