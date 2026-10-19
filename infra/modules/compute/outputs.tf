output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "load_balancer_dns_name" {
  value = aws_lb.this.dns_name
}

output "api_security_group_id" {
  value = aws_security_group.api.id
}
