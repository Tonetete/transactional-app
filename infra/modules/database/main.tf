# Multi-AZ encrypted PostgreSQL in the isolated subnets. Credentials are generated here and live in Secrets Manager.
# NOTE: generated passwords are also stored in the Terraform state, so the state backend must be private and encrypted.

locals {
  port = 5432
  # One secret per database role: the administrator (migrations only) and the two application roles.
  roles = {
    admin      = "root"
    app_user   = "app_user"
    relay_user = "outbox_relay"
  }
}

resource "random_password" "role" {
  for_each = local.roles
  length   = 32
  special  = false
}

resource "aws_secretsmanager_secret" "role" {
  for_each                = local.roles
  name                    = "${var.name}/database/${each.key}"
  recovery_window_in_days = var.protect_data ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "role" {
  for_each  = local.roles
  secret_id = aws_secretsmanager_secret.role[each.key].id
  secret_string = jsonencode({
    username = each.value
    password = random_password.role[each.key].result
  })
}

# No egress at all: the database never initiates connections. Ingress rules are added by its clients.
resource "aws_security_group" "this" {
  name        = "${var.name}-database"
  description = "Database: PostgreSQL from authorized application security groups only"
  vpc_id      = var.vpc_id
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_db_instance" "this" {
  identifier             = "${var.name}-database"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.t4g.medium"
  allocated_storage      = 50
  multi_az               = true
  storage_encrypted      = true
  publicly_accessible    = false
  db_name                = var.database_name
  username               = local.roles.admin
  password               = random_password.role["admin"].result
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.this.id]

  backup_retention_period   = 7
  deletion_protection       = var.protect_data
  skip_final_snapshot       = !var.protect_data
  final_snapshot_identifier = var.protect_data ? "${var.name}-database-final" : null
}
