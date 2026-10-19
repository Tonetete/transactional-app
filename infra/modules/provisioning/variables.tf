variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "cluster_arn" {
  type = string
}

variable "image" {
  description = "Container image with dist/provision-main.mjs."
  type        = string
}

variable "database" {
  description = "Connection details of the database module outputs."
  type = object({
    address               = string
    port                  = number
    name                  = string
    security_group_id     = string
    admin_secret_arn      = string
    app_user_secret_arn   = string
    relay_user_secret_arn = string
  })
}

variable "log_retention_days" {
  type    = number
  default = 30
}
