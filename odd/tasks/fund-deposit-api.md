# Fund Deposit via Bank Transfer Request — phase 01 (sync API)
Nx monorepo (pnpm), Fastify API, Kysely + Postgres RLS, Vitest + Testcontainers. Web (Next.js) deferred.
Source: specs/01-PRD-SPEC.md (details also in 02/03 specs).

## Specs
- S1: Given authenticated user "usr_123" of tenant "tnt_abc" with a valid "idempotency_key", requesting a deposit of "$50,000" → transaction in "PENDING", ledger balance unchanged, "DepositRequested" event emitted, response 202 Accepted.
- S2: Given an existing deposit with idempotency key "idk_999" for tenant "tnt_abc", the exact same request again → no new transaction, response 200 OK with the ID of the original transaction.
- S3: Request of "-$5,000" → rejected immediately, 400 Bad Request.
- S4 (Isolation): "Operations must be strictly isolated per tenant... A bug in the code must not expose tenant A's transactions to tenant B." RLS via `SET LOCAL app.current_tenant_id`, UNIQUE(tenant_id, idempotency_key).
- S5 (Resilience): "The synchronous API must respond in under 200ms"; heavy work offloaded to async queue (outbox in same DB transaction).
- S6 (Traceability): "Every request must generate a correlation ID that follows the transaction across the API, the database logs, and the event-driven workers."
- S7 (State machine): PENDING, PROCESSING, SETTLED, FAILED.
- S8 (agreed assumptions): amounts as integer cents (bigint) + currency; same key with different payload → 409; transactional outbox.

## Tasks
- [x] T1 (S4,S8) Nx workspace scaffold: apps/api, packages/shared, vitest config, git — route: inline — commit: e0a77cc
- [ ] T2 (S4,S7,S8) DB migrations: tenants, accounts, transactions, outbox, RLS policies; Testcontainers harness — inline — -
- [ ] T3 (S3,S8) Request validation (amount > 0, ceiling, currency, headers) — inline — -
- [ ] T4 (S1,S5,S6) Deposit endpoint: PENDING tx + outbox event, 202, correlation ID — inline — -
- [ ] T5 (S2,S8) Idempotency: replay → 200 same ID; conflicting payload → 409; concurrent race — inline — -
- [ ] T6 (S4) Tenant isolation tests via public API — inline — -

## Log
- L1: "vamos a trabajar en un nuevo proyecto, he definido las fases de los specs en la carpeta @specs a tu disposición. Empecemos por @specs/01-PRD-SPEC.md"
- L2: "sí, por cierto se me olvidó definir de que tenemos un frontend también que debería ser hecho en next.js"
- L3: decisions: monorepo "pero usando nx"; frontend: solo backend ahora; Fastify; Kysely + Vitest + Testcontainers.
