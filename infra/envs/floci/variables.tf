variable "project" {
  type    = string
  default = "acex"
}

variable "environment" {
  description = "Part of every resource name, so this root coexists with the CDK stack deployed to the same floci."
  type        = string
  default     = "floci"
}

variable "aws_endpoint" {
  description = "Where floci listens, as seen from this machine."
  type        = string
  default     = "http://localhost:4566"
}

variable "image" {
  description = "Container image with the bundled API/relay/provisioning bundles."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate of the load balancer's HTTPS listener."
  type        = string
}
