variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Isolated (data) subnets for the instance."
  type        = list(string)
}

variable "database_name" {
  type    = string
  default = "fintech"
}

variable "protect_data" {
  description = <<-EOT
    True for environments that hold real data: deletion protection, a final snapshot, and a recovery window for the
    secrets. False for disposable environments (the floci emulator), which must be destroyable and re-creatable.
  EOT
  type        = bool
}
