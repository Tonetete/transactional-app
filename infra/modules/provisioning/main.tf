# One-off task (not a service): applies migrations with the admin role and sets the app_user / outbox_relay passwords
# from their secrets. Run it with the `run_command` output after the first apply and after any apply that adds
# migrations or rotates a database secret.

data "aws_region" "current" {}

locals {
  secret_arns = [var.database.admin_secret_arn, var.database.app_user_secret_arn, var.database.relay_user_secret_arn]
  # ECS resolves "<arn>:<json key>::" to one field of a JSON secret.
  secrets = {
    ADMIN_DB_USER     = "${var.database.admin_secret_arn}:username::"
    ADMIN_DB_PASSWORD = "${var.database.admin_secret_arn}:password::"
    DB_USER           = "${var.database.app_user_secret_arn}:username::"
    DB_PASSWORD       = "${var.database.app_user_secret_arn}:password::"
    RELAY_DB_USER     = "${var.database.relay_user_secret_arn}:username::"
    RELAY_DB_PASSWORD = "${var.database.relay_user_secret_arn}:password::"
  }
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/${var.name}/provision"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name}-provision-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "execution" {
  name = "execution"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = "*"
      },
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = aws_cloudwatch_log_group.this.arn },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = local.secret_arns },
    ]
  })
}

# The task role stays without permissions: secrets are injected by the execution role and the task only talks to PostgreSQL.
resource "aws_iam_role" "task" {
  name               = "${var.name}-provision-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name}-provision"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "provision"
    image     = var.image
    essential = true
    command   = ["node", "dist/provision-main.mjs"]

    environment = [
      { name = "DB_HOST", value = var.database.address },
      { name = "DB_PORT", value = tostring(var.database.port) },
      { name = "DB_NAME", value = var.database.name },
    ]
    secrets = [for k, v in local.secrets : { name = k, valueFrom = v }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.this.name
        "awslogs-region"        = data.aws_region.current.region
        "awslogs-stream-prefix" = "provision"
      }
    }
  }])
}

# The lifecycle ignore on the database rules is explained in modules/compute/security.tf.
resource "aws_security_group" "this" {
  name        = "${var.name}-provision"
  description = "Provisioning task: egress to PostgreSQL and HTTPS only, no inbound"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.this.id
  description       = "HTTPS (ECR, Secrets Manager, logs)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "to_database" {
  security_group_id            = aws_security_group.this.id
  description                  = "PostgreSQL"
  referenced_security_group_id = var.database.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.database.port
  to_port                      = var.database.port
  lifecycle { ignore_changes = [referenced_security_group_id] }
}

resource "aws_vpc_security_group_ingress_rule" "database_from_provisioning" {
  security_group_id            = var.database.security_group_id
  description                  = "PostgreSQL from the provisioning task"
  referenced_security_group_id = aws_security_group.this.id
  ip_protocol                  = "tcp"
  from_port                    = var.database.port
  to_port                      = var.database.port
  lifecycle { ignore_changes = [referenced_security_group_id] }
}
