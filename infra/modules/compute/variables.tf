variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  description = "Subnets of the load balancer."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Subnets of the API and relay tasks."
  type        = list(string)
}

variable "image" {
  description = "Container image with the bundled API (dist/main.mjs, dist/relay-main.mjs)."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate of the HTTPS listener."
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

variable "queue_url" {
  type = string
}

variable "queue_arn" {
  type = string
}

variable "cors_origin" {
  description = "Single web origin allowed by CORS (optional)."
  type        = string
  default     = null
}

variable "enable_http_listener" {
  description = "Also serve plain HTTP:80. Only for an emulator that does not terminate TLS; the load balancer is then reached through CloudFront."
  type        = bool
  default     = false
}

variable "enable_dev_login" {
  description = "Enable the simulated login, which needs an admin database credential. Never outside an emulator."
  type        = bool
  default     = false
}

variable "aws_endpoint_override" {
  description = "Endpoint the relay uses for AWS APIs, when an emulator's default is not reachable from its containers."
  type        = string
  default     = null
}

variable "secret_recovery_window_days" {
  description = "Recovery window of the JWT secret; 0 deletes it immediately so the name can be reused."
  type        = number
  default     = 30
}

variable "log_retention_days" {
  type    = number
  default = 30
}
