data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

locals {
  api_secret_arns = concat(
    [var.database.app_user_secret_arn, aws_secretsmanager_secret.jwt.arn],
    var.enable_dev_login ? [var.database.admin_secret_arn] : [],
  )
}

# The execution role is what ECS itself uses: pull the image, write logs, read the secrets injected into the container.
resource "aws_iam_role" "execution" {
  for_each           = toset(["api", "relay"])
  name               = "${var.name}-${each.key}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "execution" {
  for_each = aws_iam_role.execution
  name     = "execution"
  role     = each.value.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = "*"
      },
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = aws_cloudwatch_log_group.service[each.key].arn },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = each.key == "api" ? local.api_secret_arns : [var.database.relay_user_secret_arn] },
    ]
  })
}

# Task roles are what the application code runs as. The API needs no AWS API; the relay only sends to its queue.
resource "aws_iam_role" "api_task" {
  name               = "${var.name}-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role" "relay_task" {
  name               = "${var.name}-relay-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "relay_send_messages" {
  name = "send-messages"
  role = aws_iam_role.relay_task.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["sqs:SendMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"], Resource = var.queue_arn }]
  })
}
