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

module "compute" {
  source             = "../../modules/compute"
  name               = local.name
  vpc_id             = module.network.vpc_id
  public_subnet_ids  = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
  image              = var.image
  certificate_arn    = var.certificate_arn
  queue_url          = module.messaging.queue_url
  queue_arn          = module.messaging.queue_arn

  enable_http_listener        = true
  enable_dev_login            = true
  aws_endpoint_override       = "http://floci:4566"
  secret_recovery_window_days = 0

  database = {
    address               = module.database.address
    port                  = module.database.port
    name                  = module.database.database_name
    security_group_id     = module.database.security_group_id
    admin_secret_arn      = module.database.admin_secret_arn
    app_user_secret_arn   = module.database.app_user_secret_arn
    relay_user_secret_arn = module.database.relay_user_secret_arn
  }
}

module "provisioning" {
  source             = "../../modules/provisioning"
  name               = local.name
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  cluster_arn        = module.compute.cluster_arn
  image              = var.image

  database = {
    address               = module.database.address
    port                  = module.database.port
    name                  = module.database.database_name
    security_group_id     = module.database.security_group_id
    admin_secret_arn      = module.database.admin_secret_arn
    app_user_secret_arn   = module.database.app_user_secret_arn
    relay_user_secret_arn = module.database.relay_user_secret_arn
  }
}

module "settlement" {
  source                = "../../modules/settlement"
  name                  = local.name
  vpc_id                = module.network.vpc_id
  private_subnet_ids    = module.network.private_subnet_ids
  source_dir            = var.settlement_source_dir
  queue_arn             = module.messaging.queue_arn
  timeout_seconds       = module.messaging.consumer_timeout_seconds
  aws_endpoint_override = "http://floci:4566"

  database = {
    address             = module.database.address
    port                = module.database.port
    name                = module.database.database_name
    security_group_id   = module.database.security_group_id
    app_user_secret_arn = module.database.app_user_secret_arn
  }
}

module "web_hosting" {
  source       = "../../modules/web_hosting"
  name         = local.name
  protect_data = false
  # CloudFront reaches the load balancer HTTP listener from inside floci.
  api_origin = { domain_name = "localhost", http_port = 80 }
}
