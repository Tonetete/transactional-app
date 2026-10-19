output "queue_url" {
  value = module.messaging.queue_url
}

output "database_address" {
  value = module.database.address
}

output "database_port" {
  value = module.database.port
}

output "provision_command" {
  value = module.provisioning.run_command
}

output "load_balancer_dns_name" {
  value = module.compute.load_balancer_dns_name
}
