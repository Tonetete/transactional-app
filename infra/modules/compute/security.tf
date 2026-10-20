# Security groups: nothing is open unless a rule below says so.
#
# The rules that name another security group ignore `referenced_security_group_id` after creation: floci reports it as
# "<account>/sg-..." and Terraform would otherwise plan a permanent in-place change. Real AWS is unaffected.

resource "aws_security_group" "load_balancer" {
  name        = "${var.name}-load-balancer"
  description = "Load balancer: HTTPS from the internet"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "load_balancer_https" {
  security_group_id = aws_security_group.load_balancer.id
  description       = "HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "load_balancer_http" {
  count             = var.enable_http_listener ? 1 : 0
  security_group_id = aws_security_group.load_balancer.id
  description       = "HTTP (emulator only)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "load_balancer_to_api" {
  security_group_id            = aws_security_group.load_balancer.id
  description                  = "To the API tasks"
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = local.api_port
  to_port                      = local.api_port
  lifecycle { ignore_changes = [referenced_security_group_id] }
}

resource "aws_security_group" "api" {
  name        = "${var.name}-api"
  description = "API service: traffic from the load balancer only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "api_from_load_balancer" {
  security_group_id            = aws_security_group.api.id
  description                  = "From the load balancer"
  referenced_security_group_id = aws_security_group.load_balancer.id
  ip_protocol                  = "tcp"
  from_port                    = local.api_port
  to_port                      = local.api_port
  lifecycle { ignore_changes = [referenced_security_group_id] }
}

resource "aws_security_group" "relay" {
  name        = "${var.name}-relay"
  description = "Outbox relay: no inbound, egress to PostgreSQL and HTTPS"
  vpc_id      = var.vpc_id
}

# Both services reach AWS APIs over HTTPS and PostgreSQL; the database accepts them and nobody else.
locals {
  database_clients = { api = aws_security_group.api.id, relay = aws_security_group.relay.id }
}

resource "aws_vpc_security_group_egress_rule" "https" {
  for_each          = local.database_clients
  security_group_id = each.value
  description       = "HTTPS (ECR, Secrets Manager, logs, SQS)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "to_database" {
  for_each                     = local.database_clients
  security_group_id            = each.value
  description                  = "PostgreSQL"
  referenced_security_group_id = var.database.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.database.port
  to_port                      = var.database.port
  lifecycle { ignore_changes = [referenced_security_group_id] }
}

resource "aws_vpc_security_group_ingress_rule" "database_from_client" {
  for_each                     = local.database_clients
  security_group_id            = var.database.security_group_id
  description                  = "PostgreSQL from the ${each.key} service"
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = var.database.port
  to_port                      = var.database.port
  lifecycle { ignore_changes = [referenced_security_group_id] }
}
