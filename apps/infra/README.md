# @acex/infra — AWS CDK (specs/04-IAC-SPEC.md)

| Construct | Spec | What it declares |
| --- | --- | --- |
| `Network` | S1 | VPC, 2 AZs: public (ALB, NAT per AZ), private app (egress via NAT), isolated data (no routes out) |
| `Database` | S2 | RDS PostgreSQL 16 Multi-AZ, encrypted, isolated subnets, no egress; generated secrets for `root`, `app_user`, `outbox_relay` |
| `Messaging` | S4 | `TransactionsQueue` -> `TransactionsDLQ` after 3 receives; SSE + TLS-only; visibility = 6x Lambda timeout |
| `Settlement` | S4 | SQS-triggered Lambda (batch failure reporting), private subnets, reads only the `app_user` secret |
| `Provisioning` | S2 | One-off Fargate task (`node dist/provision-main.mjs`): migrations with the admin role + `app_user` / `outbox_relay` passwords from their secrets; empty task role |
| `WebHosting` | web | Private S3 bucket + CloudFront (OAC, HTTPS redirect) for the static export of `apps/web`; content uploaded by script |
| `Compute` | S3, S5 | Fargate API x2 behind an HTTPS-only ALB (`/health`), outbox relay service, task roles with no wildcard actions |

## Commands
```bash
pnpm --filter @acex/infra test        # assertions on the synthesized template (no AWS access needed)
pnpm --filter @acex/infra typecheck
env -u CDK_DEFAULT_ACCOUNT pnpm --filter @acex/infra synth -c certificateArn=arn:aws:acm:...   # offline synth
```
`certificateArn` (ACM, same region) is mandatory: the ALB only listens on 443. Optional `-c corsOrigin=https://app.example.com`.
The API image is built from `apps/api/Dockerfile` (repository root as context) by `cdk deploy`; the settlement Lambda is bundled with esbuild.

## First deploy: provision the database
After `cdk deploy`, run the command printed in the `ProvisionCommand` stack output (`aws ecs run-task ...`) and read the result in
CloudWatch (`/provision` log stream). It is idempotent: run it again after adding a migration or rotating a database secret
(then restart the API and relay services so they pick up the new secret value). It does not seed tenants.

## Deploying to floci
See "Deploy the whole stack to floci" in `docs/LOCAL-DEV.md` (`scripts/floci-deploy.sh`, `-c target=floci` makes the database and web bucket destroyable).

## Not covered yet (decisions pending)
- **TLS verification:** RDS enforces TLS and the API connects with `sslmode=no-verify` (encrypted, server certificate not validated); shipping the RDS CA bundle is the follow-up.
- **JWT issuer:** the API verifies HS256 tokens with a generated `JwtSecret`; there is no identity provider, and the dev login route is never enabled here.
- **Web hosting** (Next.js) is not in the IaC spec and is not declared.
- **Bank:** the Lambda still wires `SimulatedBank`.
- The API task role has no SQS permission on purpose: only the relay publishes (specs/04 §6 assumed the API would).
