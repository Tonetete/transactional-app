# Terraform migration — replace AWS CDK (apps/infra) with Terraform, floci-compatible
Re-express the CDK stack as Terraform modules with intent-named variables, keeping `floci` as a first-class target. CDK stays in parallel until the last slice. Spike evidence: 59 resources applied/destroyed on floci 2.3.0 (Engram `odd/terraform-migration/spike`).

## Specs
- S1: "hacer una migración del amazon cdk a terraform y que siga siendo compatible con floci"
- S2: "refactorizarlo para hacerlo lo más semántico posible" (modules by intent; the `local` boolean becomes named variables: `protect_data`, `enable_http_listener`, `enable_dev_login`, `aws_endpoint_override`, `web_api_origin`)
- S3: "No, no hay nada, sólo alcanzaría con reemplazar" (no real AWS deployment: replace, no `terraform import`)
- S4: "Terraform" (not OpenTofu)
- S5: "Mantenlo en paralelo" (apps/infra CDK stays until the final slice)
- S6: layout `infra/` with roots `envs/aws` and `envs/floci`, modules `network`, `messaging`, `database`, `settlement`, `compute`, `provisioning`, `web_hosting`. Resource names carry `<project>-<environment>` so Terraform and the CDK stack coexist on one floci.
- S7: Tests: `terraform test` (mock providers, plan mode) per module plus the real floci cycle (apply, provision, `scripts/floci-smoke.sh`, destroy) as acceptance.

## Tasks
- [x] T1 (S1,S2,S6) PR1 skeleton: `infra/` roots, provider config, .gitignore — inline — commit 4a1abf2
- [x] T2 (S2,S6,S7) `network` module + test — inline — commit 4a1abf2
- [x] T3 (S2,S6,S7) `messaging` module + test — inline — commit 4a1abf2
- [x] T4 (S2,S6,S7) `database` module + test (secrets via random_password; `protect_data`) — inline; Risk item 1 (secrets in state) — commit 4a1abf2
- [x] T5 (S1) Verify PR1 on floci: apply, no-diff plan, destroy — inline — commit 4a1abf2
- [x] T6 (S2,S6) PR2 `compute` (api, relay, ALB, autoscaling) + `provisioning` — inline (worker timed out after wiring edits, finished inline)
- [x] T7 (S2,S6) PR3 `settlement` (Lambda packaging) + `web_hosting` — inline
- [x] T8 (S1,S7) PR4 scripts (deploy/destroy/smoke on Terraform, image build+push), full floci cycle — inline
- [ ] T9 (S5) PR5 remove CDK, update specs/04-IAC-SPEC.md, README, docs/LOCAL-DEV.md

## Log
- L1: "me gustaría crear una PR para hacer una migración del amazon cdk a terraform y que siga siendo compatible con floci. La idea es refactorizarlo para hacerlo lo más semántico posible. Corre primero una exploración y el impacto que puede tener el hacer este cambio y si es viable"
- L2: "1. No, no hay nada, sólo alcanzaría con reemplazar 2. Terraform 3. Mantenlo en paralelo"
- L3: "me sirve, sigamos" (layout `infra/`)
- L4 (spike): floci quirk: `referenced_security_group_id` returns `000000000000/sg-x` -> perpetual in-place diff; CloudFront behaviors keep methods/policies (floci-patch-cloudfront.sh obsolete).
- L5 (PR1 result): network, messaging, database modules + envs/aws and envs/floci. floci 2.3.0: apply 38 resources (~1.5 min), second plan empty, destroy clean (0 secrets left). `terraform test`: 12 tests pass (messaging TLS test mutation-checked). Slice boundary: PR1 is ~880 changed lines (lock files excluded) in one commit, over the ~400 target, because three modules, their 12 tests, two roots and the README ship together; it reviews module by module (network ~150, messaging ~150, database ~250, roots/docs ~330). PR2-PR4 are planned smaller (one concern each).
- L6 (PR2 result): compute + provisioning modules wired into both roots. floci 2.3.0: apply 83 resources (8m34s), second plan exit 0 (SG-reference drift fixed with ignore_changes on referenced_security_group_id), api 2/2 and relay 1/1 RUNNING, destroy clean (1m55s, 0 secrets left); CDK stack `Acex` untouched. 9 mock tests (compute 6, provisioning 3); compute desired_count mutation turns the autoscaling test red. The gentle-ai-worker delegated to wire the roots stalled after its edits (timed out); the parent verified its edits and ran the floci cycle.
- L7 (PR3 result): settlement module (Lambda bundled by new `pnpm --filter @acex/api bundle:lambda`, zipped by the archive provider) and web_hosting module wired into both roots. floci 2.3.0: apply 98 resources, second plan exit 0, CloudFront `/v1/*` behavior kept all 7 methods and CachingDisabled without any patch script, Lambda nodejs22.x Active, SQS mapping Enabled (batch 10, ReportBatchItemFailures), destroy clean (98, 0 secrets, 0 buckets). 11 new mock tests (settlement 6, mutation-checked on batch_size; web_hosting 5). Slice boundary: PR2+PR3 were committed as 8 small commits (module / roots / docs each) totalling ~2200 changed lines since main; each commit stays reviewable alone, and the PR can be split at the modules.
- L8 (PR4 result): registry module (ECR, built first via -target so the image exists before ECS), scripts/floci-tf-deploy.sh and floci-tf-destroy.sh, `IAC=terraform` switch in floci-smoke.sh and floci-web-deploy.sh. Cycle found two real defects, both fixed: the root lacked a `cluster_name` output (provisioning step failed) and the smoke's throwaway containers were not on floci-net, so the database address (floci-net IP) timed out; the smoke now joins floci-net, which also made its CDK mode pick the right API container when both stacks are deployed. Result on floci 2.3.0: deploy + provisioning, `IAC=terraform` smoke SETTLED, web deploy OK, `IAC=cdk` smoke still SETTLED (differential check of the shared script), destroy clean (99 resources, 0 secrets/buckets/ECR repos/queues left, CDK stack untouched). A first destroy failed because the script passed a dummy `certificate_arn` that the provider validates as an ARN; it now uses the real cert from floci-cert.sh. (A retry in the same turn also failed only because it was launched in parallel with the script edit, not because of a second defect.)
