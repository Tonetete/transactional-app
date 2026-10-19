output "queue_url" {
  value = module.messaging.queue_url
}

output "database_address" {
  value = module.database.address
}

output "database_port" {
  value = module.database.port
}
