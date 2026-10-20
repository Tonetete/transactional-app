mock_provider "aws" {
  # The provider validates ARNs even on mocked values.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111111111111:role/mock" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:111111111111:log-group:mock" }
  }
  mock_resource "aws_lambda_function" {
    defaults = { arn = "arn:aws:lambda:us-east-1:111111111111:function:mock" }
  }
}

variables {
  name               = "test"
  vpc_id             = "vpc-1"
  private_subnet_ids = ["subnet-a", "subnet-b"]
  source_dir         = "./tests/fixture"
  queue_arn          = "arn:aws:sqs:us-east-1:111111111111:q"
  database = {
    address             = "db.internal"
    port                = 5432
    name                = "fintech"
    security_group_id   = "sg-db"
    app_user_secret_arn = "arn:aws:secretsmanager:us-east-1:111111111111:secret:app"
  }
}

run "function_runs_in_the_private_subnets_with_the_queue_timeout" {
  command = apply
  variables {
    timeout_seconds = 20
  }

  assert {
    condition     = aws_lambda_function.this.runtime == "nodejs22.x" && aws_lambda_function.this.handler == "index.handler" && aws_lambda_function.this.timeout == 20
    error_message = "nodejs22.x, index.handler and the given timeout expected"
  }
  assert {
    condition     = length(one(aws_lambda_function.this.vpc_config).subnet_ids) == 2
    error_message = "The function must run in the two private subnets"
  }
}

run "queue_events_report_partial_batch_failures" {
  command = apply

  assert {
    condition     = aws_lambda_event_source_mapping.queue.batch_size == 10 && contains(aws_lambda_event_source_mapping.queue.function_response_types, "ReportBatchItemFailures") && aws_lambda_event_source_mapping.queue.maximum_batching_window_in_seconds == 0
    error_message = "Batches of 10, no batching window, ReportBatchItemFailures"
  }
}

run "function_may_only_read_its_queue_and_the_app_user_secret" {
  command = apply

  assert {
    condition     = [for s in jsondecode(aws_iam_role_policy.function.policy).Statement : s.Resource if contains(s.Action, "secretsmanager:GetSecretValue")][0] == var.database.app_user_secret_arn
    error_message = "Only the app_user secret may be read"
  }
  assert {
    condition     = [for s in jsondecode(aws_iam_role_policy.function.policy).Statement : s.Resource if contains(s.Action, "sqs:ReceiveMessage")][0] == var.queue_arn
    error_message = "Only its queue may be consumed"
  }
  assert {
    condition     = !contains([for s in jsondecode(aws_iam_role_policy.function.policy).Statement : contains(s.Action, "sqs:SendMessage")], true)
    error_message = "The function must not send messages"
  }
}

run "function_reaches_only_the_database_and_https" {
  command = apply

  assert {
    condition     = aws_vpc_security_group_egress_rule.https.from_port == 443 && aws_vpc_security_group_egress_rule.to_database.from_port == 5432 && length(aws_security_group.function.ingress) == 0
    error_message = "Egress to HTTPS and PostgreSQL only, no inbound"
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.database_from_function.security_group_id == "sg-db"
    error_message = "The database must accept the function"
  }
}

run "emulator_endpoint_is_opt_in" {
  command = apply

  assert {
    condition     = !contains(keys(one(aws_lambda_function.this.environment).variables), "AWS_ENDPOINT_URL")
    error_message = "No endpoint override by default"
  }
}

run "emulator_endpoint_override_reaches_the_function" {
  command = apply
  variables {
    aws_endpoint_override = "http://floci:4566"
  }

  assert {
    condition     = one(aws_lambda_function.this.environment).variables["AWS_ENDPOINT_URL"] == "http://floci:4566"
    error_message = "The override must reach the function"
  }
}
