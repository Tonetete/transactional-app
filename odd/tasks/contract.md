# Contract alignment — phase 03 (contract spec)
Make specs/03-CONTRACT-SPEC.md the executable single source of truth: shared contract module, tenant header rule, immutable ledger entries. Bank stays simulated (no access to the real platform yet).

## Specs
- S1: "Event Envelope ... Global event ID, schema version (to allow backward-compatible evolution), UTC timestamp, tenant ID, and the correlation ID inherited from the originating HTTP request." + "Business Payload: ... internal transaction ID, target account ID, reconciliation amount, and source banking details."
- S2: "Success Response: Returns the transaction ID, initial lifecycle state (`PENDING`), and an explicit boolean flag indicating whether the transaction was freshly created or resolved as an idempotent duplicate." / "Error Response: A predictable structure containing an error code, a human-readable message, and the correlation identifier". Decision: a replay reports the CURRENT status; first 202 is PENDING.
- S3: "Mandatory Security and Context Headers: Tenant Identifier ... Idempotency Key ... Correlation Identifier". Decision: tenant comes from the JWT (spec 02); optional X-Tenant-Id must match, else 403 TENANT_MISMATCH.
- S4: "Transactions: An immutable ledger record of fund movements associated with an account." Decision: append-only ledger_entries (CREDIT on SETTLED), UPDATE/DELETE blocked by trigger; transactions remains the state machine.
- S5: "Monetary Precision Guarantee" integer cents; "Multi-Tenant Isolation Rule (RLS)" also applies to ledger_entries.

## Tasks
- [x] T1 (S1,S2) Shared contract module: event envelope + schema_version validator, response and error code types; API, publisher and worker use it; contract tests — inline — 5fa3ac7 + e55c397
- [ ] T2 (S3) Optional X-Tenant-Id validated against the JWT tenant (403 TENANT_MISMATCH) — inline — -
- [ ] T3 (S4,S5) Append-only ledger_entries with RLS + immutability trigger; worker writes CREDIT on settlement; balance equals sum of entries — inline — -

## Log
- L1: "ok, vamos a ello pero el banco debe seguir siendo simulado ya que no tenemos acceso a la plataforma real aún."
- L2: decisions: JWT manda, X-Tenant-Id opcional y validado; replay devuelve estado actual; agregar ledger_entries append-only.
