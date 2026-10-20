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

variable "source_dir" {
  description = "Directory with the bundled function (index.mjs exporting `handler`); build it with `pnpm --filter @acex/api bundle:lambda`."
  type        = string
}

variable "queue_arn" {
  description = "Queue whose messages the function settles."
  type        = string
}

variable "timeout_seconds" {
  description = "Function timeout. Pass messaging's consumer_timeout_seconds so the queue visibility timeout stays derived from it."
  type        = number
  default     = 30
}

variable "database" {
  description = "Connection details of the database module outputs."
  type = object({
    address             = string
    port                = number
    name                = string
    security_group_id   = string
    app_user_secret_arn = string
  })
}

variable "aws_endpoint_override" {
  description = "Endpoint the function uses for AWS APIs, when an emulator's default is not reachable from its containers."
  type        = string
  default     = null
}

variable "log_retention_days" {
  type    = number
  default = 30
}
