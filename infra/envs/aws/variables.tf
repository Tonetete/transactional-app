variable "project" {
  type    = string
  default = "acex"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "image" {
  description = "Container image with the bundled API/relay/provisioning bundles."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate of the load balancer's HTTPS listener."
  type        = string
}

variable "cors_origin" {
  description = "Single web origin allowed by CORS (optional)."
  type        = string
  default     = null
}
