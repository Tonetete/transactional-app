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
