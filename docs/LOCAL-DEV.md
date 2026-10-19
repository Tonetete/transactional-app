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

## Deploy the whole stack to floci (Terraform)
Instead of running the API, relay and worker as local processes, `infra/envs/floci` can deploy everything to floci:
VPC, RDS, SQS + DLQ, settlement Lambda, ECS (API x2, relay), ALB and the web hosting (S3 + CloudFront).
```bash
scripts/floci-deploy.sh        # import a self-signed ACM cert, apply the registry, build+push the image, apply the rest,
                               # run the provisioning task (migrations + role passwords) and wait for it
scripts/floci-smoke.sh         # tenant -> JWT -> deposit -> relay -> SQS -> Lambda -> SETTLED
scripts/floci-web-deploy.sh    # static build of apps/web -> S3; prints the CloudFront URL served by floci
scripts/floci-destroy.sh       # terraform destroy (the web bucket is force-destroyed in this disposable environment)
```
Verified on floci 2.3.0: a from-scratch cycle (destroy, deploy, provision, smoke, web deploy) passes. Things to know:
- **Both modes can coexist.** Local dev uses `transactions-queue` / `transactions-dlq`; the stack uses
  `acex-floci-transactions` / `acex-floci-transactions-dlq`. Destroying the stack does not touch the dev queues.
- **ECR needs a user-defined network.** floci reaches its registry container by name, which the default bridge cannot
  resolve (image push fails with `503`). `scripts/floci-deploy.sh` connects `floci` and `floci-aws-ecr-registry` to a `floci-net` network.
- **floci must be started with the CloudFront private-origin allowance.** Its CloudFront blocks (SSRF protection) origins that
  resolve to local addresses, and the web's `/v1/*` origin is `localhost:80`. Run floci with
  `-e FLOCI_SERVICES_CLOUDFRONT_ALLOWED_PRIVATE_ORIGIN_HOSTS=localhost` (keep `-v /var/run/docker.sock:/var/run/docker.sock`
  and a volume on `/app/data`). Recreating the container loses its state (RDS, queues, resources); the Terraform state file then no longer matches floci, so delete `infra/envs/floci/terraform.tfstate*` before the next deploy.
- **The deployed web talks to the API through CloudFront (same origin).** The ALB HTTPS:443 listener is not reachable from the
  host (floci publishes only 4566, and its ELB does not terminate TLS). In the local profile the ALB also has an HTTP:80 listener
  and the API enables the simulated login; the distribution routes `/v1/*` to `localhost:80` inside floci. No CORS involved.
  Open the URL printed by `scripts/floci-web-deploy.sh`.
- **CloudFront behaviors are kept.** floci's CloudFormation provisioner used to drop the behavior methods and policies (hence a
  patch script under CDK); Terraform calls the CloudFront API directly and they survive, so there is no patch step.
- **Security-group references drift on floci.** floci returns `referenced_security_group_id` as `<account>/sg-...`, which would
  make Terraform plan a permanent change; the rules that name another security group ignore that attribute after creation.
- **Containers reach floci by name:** floci injects `AWS_ENDPOINT_URL=http://localhost.floci.io:4566`, but on the `floci-net` network
  that name resolves to the container itself. The local profile overrides it with `http://floci:4566` for the relay and the Lambda.
- **Log groups are declared explicitly** (with retention), which also avoids Lambda creating its own without one.
- **Provisioning is part of the deploy script**, not a manual step: it runs the one-off task and fails if it does not exit 0.
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
