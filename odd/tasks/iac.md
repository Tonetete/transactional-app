# IaC — phase 04b (AWS CDK)
Declare the AWS topology of specs/04-IAC-SPEC.md in TypeScript CDK (apps/infra), verified by synthesized-template assertions. No deploy: there is no AWS account in scope. Bank stays simulated (Lambda keeps SimulatedBank).

## Specs
- S1: "Deploys a Virtual Private Cloud (VPC) spanned across multiple Availability Zones" with "Public Subnets" (ALB, NAT), "Private Application Subnets" (outbound internet, no inbound) and "Private Isolated Data Subnets" ("zero internet routes in or out").
- S2: "Provisions a PostgreSQL database with synchronous replication to a standby instance" (RDS Multi-AZ), "storage encryption at rest alongside managed credential storage via AWS Secrets Manager", "inbound connections to PostgreSQL only from the authorized application containers" (and Lambda, per specs/02).
- S3: "Runs the Node.js API across Amazon ECS tasks backed by AWS Fargate" behind "an Application Load Balancer with periodic health checks"; "multiple concurrent tasks spread across distinct Availability Zones"; "the ALB only allows traffic on 443; ECS only accepts traffic from the ALB" (specs/02).
- S4: "Employs managed queues" + "Dead Letter Queue (DLQ)" `TransactionsDLQ` after "3 reintentos fallidos en el procesador Lambda"; visibility "adaptada al tiempo de respuesta del servicio bancario externo".
- S5: "Grants container runtime identities permission only to push messages to their specific SQS queue and read assigned secrets"; "Eliminates wildcard and administrative permissions".
- S6: "Defines all cloud topology declaratively ... friction-free deployment inside GitHub Actions CI/CD pipelines" (cdk synth runs in CI-friendly `pnpm` scripts).

## Tasks
- [x] T1 (S1,S6) apps/infra scaffold + NetworkStack/construct: VPC 3 tiers multi-AZ; synth + assertions — inline — da5de35
- [x] T2 (S2) Database construct: RDS Postgres Multi-AZ encrypted, Secrets Manager secrets, SG rules; API env support for DB_* secrets — inline — 6e5f219
- [x] T3 (S4) Messaging + settlement Lambda: queue, TransactionsDLQ (maxReceiveCount 3), event source mapping with batch failures — inline — cc9afb3
- [ ] T4 (S3,S5) Compute: Fargate API + ALB (443) + relay service, task roles, Dockerfile; no wildcard IAM test; docs — inline —

## Log
- L1: "ok, vamos a ello pero el banco debe seguir siendo simulado ya que no tenemos acceso a la plataforma real aún." (phase 04: CDK + Next.js)
- L2: "dale caña" (after web frontend, go on with CDK)
- L3: assumptions (no user answer): ALB certificate ARN supplied via context/prop; web hosting not in the IaC spec so not declared; cloud role/migration provisioning (dev:setup equivalent) left as a follow-up.
