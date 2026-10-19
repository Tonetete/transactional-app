mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { region = "us-east-1" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  # The provider validates ARNs even on mocked values.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111111111111:role/mock" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:us-east-1:111111111111:task-definition/mock:1" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:111111111111:log-group:mock" }
  }
}

variables {
  name               = "test"
  vpc_id             = "vpc-1"
  private_subnet_ids = ["subnet-a", "subnet-b"]
  cluster_arn        = "arn:aws:ecs:us-east-1:111111111111:cluster/c"
  image              = "example/acex-api:test"
  database = {
    address               = "db.internal"
    port                  = 5432
    name                  = "fintech"
    security_group_id     = "sg-db"
    admin_secret_arn      = "arn:aws:secretsmanager:us-east-1:111111111111:secret:admin"
    app_user_secret_arn   = "arn:aws:secretsmanager:us-east-1:111111111111:secret:app"
    relay_user_secret_arn = "arn:aws:secretsmanager:us-east-1:111111111111:secret:relay"
  }
}

run "task_runs_the_provision_entrypoint_with_all_three_credentials" {
  command = apply

  assert {
    condition     = contains(jsondecode(aws_ecs_task_definition.this.container_definitions)[0].command, "dist/provision-main.mjs")
    error_message = "Must run dist/provision-main.mjs"
  }
  assert {
    condition     = toset([for s in jsondecode(aws_ecs_task_definition.this.container_definitions)[0].secrets : s.name]) == toset(["ADMIN_DB_USER", "ADMIN_DB_PASSWORD", "DB_USER", "DB_PASSWORD", "RELAY_DB_USER", "RELAY_DB_PASSWORD"])
    error_message = "Admin, app_user and outbox_relay credentials are all needed"
  }
}

run "task_role_has_no_permissions_and_the_task_only_reaches_the_database_and_https" {
  command = apply

  assert {
    condition     = length(aws_security_group.this.ingress) == 0
    error_message = "No inbound traffic"
  }
  assert {
    condition     = aws_vpc_security_group_egress_rule.https.from_port == 443 && aws_vpc_security_group_egress_rule.to_database.from_port == 5432
    error_message = "Egress only to HTTPS and PostgreSQL"
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.database_from_provisioning.security_group_id == "sg-db"
    error_message = "The database must accept the provisioning task"
  }
}

run "run_command_targets_the_private_subnets_without_public_ip" {
  command = apply

  assert {
    condition     = strcontains(output.run_command, "subnets=[subnet-a,subnet-b]") && strcontains(output.run_command, "assignPublicIp=DISABLED") && strcontains(output.run_command, "--launch-type FARGATE")
    error_message = "run_command must launch a Fargate task in the private subnets without a public IP"
  }
}
