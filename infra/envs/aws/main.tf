# Real AWS. Credentials come from the standard chain (profile, SSO or CI role). Pass the state backend at init time:
#   terraform init -backend-config="bucket=<state bucket>" -backend-config="dynamodb_table=<lock table>"
# The state holds the generated database passwords: the bucket must be private, encrypted and versioned.
terraform {
  backend "s3" {
    key     = "acex/terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = { Project = var.project, Environment = var.environment, ManagedBy = "terraform" }
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
  protect_data = true
}

module "compute" {
  source             = "../../modules/compute"
  name               = local.name
  vpc_id             = module.network.vpc_id
  public_subnet_ids  = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
  image              = var.image
  certificate_arn    = var.certificate_arn
  cors_origin        = var.cors_origin
  queue_url          = module.messaging.queue_url
  queue_arn          = module.messaging.queue_arn

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
