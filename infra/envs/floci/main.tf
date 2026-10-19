# floci (local AWS emulator): same modules as envs/aws, disposable data and the emulator endpoint on every service.

provider "aws" {
  region     = "us-east-1"
  access_key = "test"
  secret_key = "test"

  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  # One endpoint per service the configuration uses.
  endpoints {
    acm            = var.aws_endpoint
    appautoscaling = var.aws_endpoint
    cloudfront     = var.aws_endpoint
    cloudwatchlogs = var.aws_endpoint
    ec2            = var.aws_endpoint
    ecr            = var.aws_endpoint
    ecs            = var.aws_endpoint
    elbv2          = var.aws_endpoint
    iam            = var.aws_endpoint
    lambda         = var.aws_endpoint
    rds            = var.aws_endpoint
    s3             = var.aws_endpoint
    secretsmanager = var.aws_endpoint
    sqs            = var.aws_endpoint
    sts            = var.aws_endpoint
  }
}

locals {
  name = "${var.project}-${var.environment}"
}

module "network" {
  source = "../../modules/network"
  name   = local.name
}

module "messaging" {
  source = "../../modules/messaging"
  name   = local.name
}

module "database" {
  source       = "../../modules/database"
  name         = local.name
  vpc_id       = module.network.vpc_id
  subnet_ids   = module.network.isolated_subnet_ids
  protect_data = false
}
