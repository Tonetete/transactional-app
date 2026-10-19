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
Set `BANK_MODE=down` and restart the worker to watch retries and the DLQ (`TransactionsDLQ`).

## Notes
- After pulling new migrations, re-run `pnpm --filter @acex/api dev:setup` (idempotent).
- Settled funds are recorded in the append-only `ledger_entries` table (one `CREDIT` per settled transaction);
  `accounts.balance_cents` always equals the sum of its entries. `UPDATE`/`DELETE` on it are blocked, even for `root`.
- `X-Tenant-Id` is optional; if sent it must equal the tenant in the JWT, otherwise `403 TENANT_MISMATCH`.
