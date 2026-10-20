# SQS-triggered Lambda that settles deposits against the (still simulated) bank.

locals {
  environment = merge(
    {
      DB_HOST       = var.database.address
      DB_PORT       = tostring(var.database.port)
      DB_NAME       = var.database.name
      DB_SECRET_ARN = var.database.app_user_secret_arn
      NODE_OPTIONS  = "--enable-source-maps"
    },
    var.aws_endpoint_override == null ? {} : { AWS_ENDPOINT_URL = var.aws_endpoint_override },
  )
}

data "archive_file" "function" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.root}/.terraform/${var.name}-settlement.zip"
}

resource "aws_cloudwatch_log_group" "function" {
  name              = "/aws/lambda/${var.name}-settlement"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "function" {
  name = "${var.name}-settlement"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "function" {
  name = "settlement"
  role = aws_iam_role.function.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.function.arn}:*" },
      # Required to run inside the VPC; these actions do not support resource-level restrictions.
      { Effect = "Allow", Action = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DeleteNetworkInterface"], Resource = "*" },
      { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = var.queue_arn },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = var.database.app_user_secret_arn },
    ]
  })
}

# The lifecycle ignore on the database rules is explained in modules/compute/security.tf.
resource "aws_security_group" "function" {
  name        = "${var.name}-settlement"
  description = "Settlement Lambda: egress to PostgreSQL and HTTPS (Secrets Manager, bank)"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.function.id
  description       = "HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "to_database" {
  security_group_id            = aws_security_group.function.id
  description                  = "PostgreSQL"
  referenced_security_group_id = var.database.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.database.port
  to_port                      = var.database.port
  lifecycle { ignore_changes = [referenced_security_group_id] }
}

resource "aws_vpc_security_group_ingress_rule" "database_from_function" {
  security_group_id            = var.database.security_group_id
  description                  = "PostgreSQL from the settlement function"
  referenced_security_group_id = aws_security_group.function.id
  ip_protocol                  = "tcp"
  from_port                    = var.database.port
  to_port                      = var.database.port
  lifecycle { ignore_changes = [referenced_security_group_id] }
}

resource "aws_lambda_function" "this" {
  function_name    = "${var.name}-settlement"
  role             = aws_iam_role.function.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.function.output_path
  source_code_hash = data.archive_file.function.output_base64sha256
  timeout          = var.timeout_seconds
  memory_size      = 512

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.function.id]
  }

  environment {
    variables = local.environment
  }

  # The log group must exist (and be ours) before the function creates its own with no retention.
  depends_on = [aws_cloudwatch_log_group.function, aws_iam_role_policy.function]
}

resource "aws_lambda_event_source_mapping" "queue" {
  event_source_arn                   = var.queue_arn
  function_name                      = aws_lambda_function.this.arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
}
