resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution["api"].arn
  task_role_arn            = aws_iam_role.api_task.arn

  container_definitions = jsonencode([{
    name         = "api"
    image        = var.image
    essential    = true
    portMappings = [{ containerPort = local.api_port }]

    environment = [for k, v in merge(
      local.database_env,
      { PORT = tostring(local.api_port) },
      var.cors_origin == null ? {} : { CORS_ORIGIN = var.cors_origin },
      var.enable_dev_login ? { DEV_LOGIN_ENABLED = "true" } : {},
    ) : { name = k, value = v }]

    secrets = [for k, v in merge(
      {
        DB_USER     = local.secret_field.app.username
        DB_PASSWORD = local.secret_field.app.password
        JWT_SECRET  = aws_secretsmanager_secret.jwt.arn
      },
      # The dev login provisions tenants, which app_user may not do.
      var.enable_dev_login ? { ADMIN_DB_USER = local.secret_field.admin.username, ADMIN_DB_PASSWORD = local.secret_field.admin.password } : {},
    ) : { name = k, valueFrom = v }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service["api"].name
        "awslogs-region"        = data.aws_region.current.region
        "awslogs-stream-prefix" = "api"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  launch_type     = "FARGATE"
  desired_count   = 2 # spread over the two AZs by the Fargate scheduler

  deployment_minimum_healthy_percent = 100
  health_check_grace_period_seconds  = 30

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = local.api_port
  }

  depends_on = [aws_lb_listener.https, aws_lb_listener.http]

  # Autoscaling owns the task count after creation.
  lifecycle { ignore_changes = [desired_count] }
}

resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.api.name}"
  min_capacity       = 2
  max_capacity       = 6
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.name}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  resource_id        = aws_appautoscaling_target.api.resource_id

  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
