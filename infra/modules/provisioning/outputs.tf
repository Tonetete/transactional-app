output "run_command" {
  description = "Run once after apply (and after migrations or secret rotation); follow the logs in CloudWatch under /<name>/provision."
  value = join(" ", [
    "aws ecs run-task --cluster ${var.cluster_arn} --launch-type FARGATE --task-definition ${aws_ecs_task_definition.this.arn}",
    "--network-configuration \"awsvpcConfiguration={subnets=[${join(",", var.private_subnet_ids)}],securityGroups=[${aws_security_group.this.id}],assignPublicIp=DISABLED}\"",
    "--region ${data.aws_region.current.region}",
  ])
}
