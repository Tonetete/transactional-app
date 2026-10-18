# Async settlement pipeline — phase 02 (system spec)
Outbox publisher -> SQS standard (+DLQ after 3 receives) -> worker handler (PENDING->PROCESSING->SETTLED|FAILED). Bank behind a port with a simulated adapter. Tests: Testcontainers Postgres + floci (AWS emulator at localhost:4566).
Source: specs/02-SYSTEM-SPEC.md §3-§5 (infra §1,2,4,5-network belongs to phase 04 CDK).

## Specs
- S1: "Desacoplamiento asíncrono utilizando Amazon SQS junto a funciones serverless AWS Lambda para el procesamiento de transacciones hacia terceros."
- S2: "Tras 3 reintentos fallidos en el procesador Lambda, el mensaje se redirige a `TransactionsDLQ` para análisis manual y evitar el bloqueo del pipeline."
- S3: "Uso de colas SQS FIFO o verificación secundaria en el consumidor Lambda para garantizar que una reentrega del mensaje nunca duplique el saldo contable." (decision: standard queue + DB-level idempotency in consumer)
- S4: "Si el proveedor bancario externo está caído, el endpoint HTTP sigue respondiendo 202 (`PENDING`) y la cola retiene los eventos hasta la recuperación del servicio."
- S5: "Propagación del identificador en los atributos del mensaje SQS y en cada log estructurado (JSON)"; correlation ID follows API -> DB -> workers (PRD).
- S6 (PRD state machine): PENDING -> PROCESSING -> SETTLED (funds credited to the internal ledger) | FAILED (external bank rejection or fraud flag).

## Tasks
- [x] T1 (S1,S5) SQS client + outbox publisher (SKIP LOCKED poll, correlation as message attribute, marks published_at) — inline — 06e5cb0
- [ ] T2 (S3,S6) Worker handler: state transitions + single credit under redelivery; BankClient port + simulated adapter — inline — -
- [ ] T3 (S2,S4) Failure handling: bank down -> retry, DLQ after 3 receives; API still 202 — inline — -
- [ ] T4 (S5) Structured JSON logger with correlation id in API, publisher, worker — inline — -
- [ ] T5 (S1-S6) End-to-end test: deposit -> publish -> worker -> balance — inline — -

## Log
- L1: "y la fase 2>"
- L2: decisions: publisher as separate process/Lambda with polling; SQS standard + idempotent consumer; bank as port + simulated adapter; tests with the user's running floci-aws emulator ("tengo una instancia ejecutando de floci-aws que emula aws, podemos usar ese").
