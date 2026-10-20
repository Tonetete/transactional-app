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

variable "image_tag" {
  description = "Tag of the API image in the registry module's repository (scripts push it before the full apply)."
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

variable "settlement_source_dir" {
  description = "Bundled settlement function: build it first with `pnpm --filter @acex/api bundle:lambda`."
  type        = string
  default     = "../../../apps/api/dist/lambda"
}

variable "web_bucket_name" {
  description = "Globally unique name of the web bucket (defaults to <project>-<environment>-web)."
  type        = string
  default     = null
}
