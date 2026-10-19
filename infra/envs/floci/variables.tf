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

variable "image_tag" {
  description = "Tag of the API image in the registry module's repository (scripts push it before the full apply)."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate of the load balancer's HTTPS listener."
  type        = string
}

variable "settlement_source_dir" {
  description = "Bundled settlement function: build it first with `pnpm --filter @acex/api bundle:lambda`."
  type        = string
  default     = "../../../apps/api/dist/lambda"
}
