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
