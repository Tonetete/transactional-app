# Container registry for the API image. It is created before the rest of the stack so the image can be pushed first
# (scripts/floci-deploy.sh applies this module, pushes, then applies everything else with the image tag).

resource "aws_ecr_repository" "api" {
  name         = "${var.name}-api"
  force_delete = !var.protect_data

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}
