output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  description = "Load balancer and NAT subnets."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Application subnets (outbound through NAT)."
  value       = aws_subnet.private[*].id
}

output "isolated_subnet_ids" {
  description = "Data subnets (no internet route)."
  value       = aws_subnet.isolated[*].id
}
