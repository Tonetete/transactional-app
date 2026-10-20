variable "name" {
  description = "Prefix for resource names and the Name tag."
  type        = string
}

variable "cidr_block" {
  description = "CIDR of the VPC; each tier gets one /24 per availability zone."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to spread the three tiers over."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2
    error_message = "At least two availability zones are required for fault tolerance."
  }
}
