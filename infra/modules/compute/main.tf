# API (ECS Fargate behind an ALB) and the outbox relay (separate Fargate service).

data "aws_region" "current" {}

locals {
  api_port = 3000

  database_env = {
    DB_HOST = var.database.address
    DB_PORT = tostring(var.database.port)
    DB_NAME = var.database.name
  }

  # ECS resolves "<arn>:<json key>::" to one field of a JSON secret.
  secret_field = { for k, arn in {
    admin = var.database.admin_secret_arn, app = var.database.app_user_secret_arn, relay = var.database.relay_user_secret_arn
  } : k => { username = "${arn}:username::", password = "${arn}:password::" } }
}

resource "aws_ecs_cluster" "this" {
  name = var.name
}

# HS256 signing key shared with the token issuer (assumption until an identity provider exists).
resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${var.name}/api/jwt"
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = toset(["api", "relay"])
  name              = "/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
}
