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
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:111111111111:loadbalancer/app/mock/1" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:111111111111:targetgroup/mock/1" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:us-east-1:111111111111:cluster/mock" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:us-east-1:111111111111:task-definition/mock:1" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:us-east-1:111111111111:secret:mock" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:111111111111:log-group:mock" }
  }
}
mock_provider "random" {}

variables {
  name               = "test"
  vpc_id             = "vpc-1"
  public_subnet_ids  = ["subnet-pub-1", "subnet-pub-2"]
  private_subnet_ids = ["subnet-prv-1", "subnet-prv-2"]
  image              = "example/acex-api:test"
  certificate_arn    = "arn:aws:acm:us-east-1:111111111111:certificate/c"
  queue_url          = "https://sqs.us-east-1.amazonaws.com/111111111111/q"
  queue_arn          = "arn:aws:sqs:us-east-1:111111111111:q"
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

run "api_runs_two_private_fargate_tasks_that_autoscale" {
  command = apply

  assert {
    condition     = aws_ecs_service.api.launch_type == "FARGATE" && aws_ecs_service.api.desired_count == 2
    error_message = "API must run two Fargate tasks"
  }
  assert {
    condition     = one(aws_ecs_service.api.network_configuration).assign_public_ip == false && length(one(aws_ecs_service.api.network_configuration).subnets) == 2
    error_message = "API tasks must be in the two private subnets without public IPs"
  }
  assert {
    condition     = aws_appautoscaling_target.api.min_capacity == 2 && aws_appautoscaling_target.api.max_capacity == 6 && one(aws_appautoscaling_policy.api_cpu.target_tracking_scaling_policy_configuration).target_value == 60
    error_message = "Autoscaling must be 2-6 tasks at 60% CPU"
  }
}

run "load_balancer_is_public_with_https_and_a_health_check_only" {
  command = apply

  assert {
    condition     = aws_lb.this.internal == false && aws_lb.this.load_balancer_type == "application"
    error_message = "Internet-facing application load balancer expected"
  }
  assert {
    condition     = aws_lb_listener.https.port == 443 && aws_lb_listener.https.protocol == "HTTPS" && length(aws_lb_listener.http) == 0
    error_message = "Only the HTTPS:443 listener by default"
  }
  assert {
    condition     = one(aws_lb_target_group.api.health_check).path == "/health"
    error_message = "Health check must hit /health"
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.load_balancer_http) == 0
    error_message = "Port 80 must stay closed by default"
  }
}

run "relay_is_a_single_task_that_sends_to_the_queue_only" {
  command = apply

  assert {
    condition     = aws_ecs_service.relay.desired_count == 1
    error_message = "One relay task"
  }
  assert {
    condition     = contains(jsondecode(aws_ecs_task_definition.relay.container_definitions)[0].command, "dist/relay-main.mjs")
    error_message = "Relay must run dist/relay-main.mjs"
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.relay_send_messages.policy).Statement[0].Resource == var.queue_arn
    error_message = "The relay may only use its queue"
  }
}

run "api_gets_database_roles_from_secrets_and_no_admin_credential" {
  command = apply

  assert {
    condition     = !contains([for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.name], "ADMIN_DB_PASSWORD")
    error_message = "The admin credential must not reach the API by default"
  }
  assert {
    condition     = contains([for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.name], "DB_PASSWORD") && contains([for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.name], "JWT_SECRET")
    error_message = "The API needs app_user and JWT secrets"
  }
  assert {
    condition     = !contains([for e in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment : e.name], "DEV_LOGIN_ENABLED")
    error_message = "Dev login must be off by default"
  }
}

run "database_accepts_the_api_and_the_relay" {
  command = apply

  assert {
    condition     = toset(keys(aws_vpc_security_group_ingress_rule.database_from_client)) == toset(["api", "relay"])
    error_message = "Database ingress for the API and the relay only"
  }
  assert {
    condition     = alltrue([for r in aws_vpc_security_group_ingress_rule.database_from_client : r.security_group_id == "sg-db" && r.from_port == 5432])
    error_message = "Rules must be on the database security group, PostgreSQL port"
  }
}

run "emulator_options_are_explicit" {
  command = apply
  variables {
    enable_http_listener  = true
    enable_dev_login      = true
    aws_endpoint_override = "http://floci:4566"
  }

  assert {
    condition     = length(aws_lb_listener.http) == 1 && length(aws_vpc_security_group_ingress_rule.load_balancer_http) == 1
    error_message = "HTTP listener and port 80 rule expected"
  }
  assert {
    condition     = contains([for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.name], "ADMIN_DB_PASSWORD") && contains([for e in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment : e.name], "DEV_LOGIN_ENABLED")
    error_message = "Dev login needs the flag and the admin credential"
  }
  assert {
    condition     = contains([for e in jsondecode(aws_ecs_task_definition.relay.container_definitions)[0].environment : e.value], "http://floci:4566")
    error_message = "The relay must use the endpoint override"
  }
}
