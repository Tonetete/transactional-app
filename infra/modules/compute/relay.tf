resource "aws_ecs_task_definition" "relay" {
  family                   = "${var.name}-relay"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution["relay"].arn
  task_role_arn            = aws_iam_role.relay_task.arn

  container_definitions = jsonencode([{
    name      = "relay"
    image     = var.image
    essential = true
    command   = ["node", "dist/relay-main.mjs"]

    environment = [for k, v in merge(
      local.database_env,
      { QUEUE_URL = var.queue_url },
      var.aws_endpoint_override == null ? {} : { AWS_ENDPOINT_URL = var.aws_endpoint_override },
    ) : { name = k, value = v }]

    secrets = [
      { name = "RELAY_DB_USER", valueFrom = local.secret_field.relay.username },
      { name = "RELAY_DB_PASSWORD", valueFrom = local.secret_field.relay.password },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service["relay"].name
        "awslogs-region"        = data.aws_region.current.region
        "awslogs-stream-prefix" = "relay"
      }
    }
  }])
}

resource "aws_ecs_service" "relay" {
  name            = "relay"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.relay.arn
  launch_type     = "FARGATE"
  desired_count   = 1 # SKIP LOCKED makes extra replicas safe; one keeps cost lean and ECS replaces a failed task

  deployment_minimum_healthy_percent = 100

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.relay.id]
    assign_public_ip = false
  }
}
