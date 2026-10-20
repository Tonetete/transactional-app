output "address" {
  value = aws_db_instance.this.address
}

output "port" {
  description = "The port the instance reports; emulators do not always use 5432."
  value       = aws_db_instance.this.port
}

output "database_name" {
  value = var.database_name
}

output "security_group_id" {
  description = "Attach ingress rules here for every client that may connect."
  value       = aws_security_group.this.id
}

output "admin_secret_arn" {
  description = "Master credentials (administration and migrations only)."
  value       = aws_secretsmanager_secret.role["admin"].arn
}

output "app_user_secret_arn" {
  description = "Credentials of the RLS-subject app_user role (API and settlement Lambda)."
  value       = aws_secretsmanager_secret.role["app_user"].arn
}

output "relay_user_secret_arn" {
  description = "Credentials of the outbox_relay role."
  value       = aws_secretsmanager_secret.role["relay_user"].arn
}
