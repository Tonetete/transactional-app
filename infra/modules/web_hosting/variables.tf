variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "bucket_name" {
  description = "Bucket name (globally unique on real AWS). Defaults to <name>-web."
  type        = string
  default     = null
}

variable "protect_data" {
  description = "True keeps the bucket and its content when the stack is destroyed; false lets it be emptied and deleted."
  type        = bool
}

variable "api_origin" {
  description = <<-EOT
    Serve the API from the same domain: `/v1/*` goes to this HTTP origin, so the browser needs no CORS and the load
    balancer no TLS. Only for an emulator, where the origin is the load balancer's HTTP listener seen from inside it
    (floci must list the host in FLOCI_SERVICES_CLOUDFRONT_ALLOWED_PRIVATE_ORIGIN_HOSTS).
  EOT
  type = object({
    domain_name = string
    http_port   = optional(number, 80)
  })
  default = null
}
