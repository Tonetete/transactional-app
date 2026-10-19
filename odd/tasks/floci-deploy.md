# Floci deploy — deploy the whole CDK architecture to floci (local AWS emulator)
Provision all IaC resources (network, RDS, queues, Lambda, ECS API + relay + provisioning task, ALB) plus new frontend hosting (S3 + CloudFront) into floci with `cdk deploy`, and check the stack works end to end locally. Bank stays simulated. MVP: documented gaps are acceptable.

## Specs
- S1: "Quiero ver si provisionando el IaC de todos los recursos, despliega la arquitectura en local"
- S2: "el frontend puedes crear el IaC para crear el s3 y el CF en nuestro setup de flocci"
- S3: "todo se desplegaría en floci"
- S4: "se trata de un MVP y con qué funcione el stack en local, me vale" (every floci limitation found is documented, not worked around silently)
- S5: "sigamos con simulado" (bank), identity/TLS-verify/CI/assumptions left as documented gaps

## Tasks
- [ ] T1 (S1,S3) Floci deploy profile: bootstrap, certificate import, local overrides (deletion protection off, removal destroy), deploy script — inline —
- [ ] T2 (S2) Web hosting construct: private S3 bucket + CloudFront (OAC), static export of apps/web, upload script; tests — inline —
- [ ] T3 (S1,S3,S4) Iterate `cdk deploy` on floci until every resource deploys or a limitation is documented — inline —
- [ ] T4 (S1,S4) Provision DB via the ECS task, smoke the stack end to end, document in docs/LOCAL-DEV.md and README — inline —

## Log
- L1: "ok, vamos a ello pero el banco debe seguir siendo simulado ya que no tenemos acceso a la plataforma real aún."
- L2: "1. sigamos con simulado 2. el frontend puedes crear el IaC para crear el s3 y el CF en nuestro setup de flocci 3. todo se desplegaría en floci 4. lo podemos dejar así por ahora 5. lo dejamos así por ahora 6. lo dejamos así por ahora 7. no importa eso ahora"
- L3: "Todos los puntos omitidos lo podemos documentar y acometer más tarde, se trata de un MVP y con qué funcione el stack en local, me vale. Quiero ver si provisionando el IaC de todos los recursos, despliega la arquitectura en local"
- L4 (probe): floci 2.3.0 at localhost:4566 reports cloudformation, ecs, ecr, elbv2, ec2, cloudfront, acm, rds, lambda running; `cdk bootstrap aws://000000000000/us-east-1` succeeds with AWS_ENDPOINT_URL.
