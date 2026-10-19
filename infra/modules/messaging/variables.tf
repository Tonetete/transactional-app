variable "name" {
  description = "Prefix for the queue names."
  type        = string
}

variable "consumer_timeout_seconds" {
  description = "Timeout of the function that consumes the queue; the visibility timeout is derived from it."
  type        = number
  default     = 30
}

variable "max_receive_count" {
  description = "Failed receives before a message moves to the dead-letter queue (specs/02: 3 retries)."
  type        = number
  default     = 3
}

variable "dlq_retention_days" {
  description = "How long dead-lettered messages are kept for manual audit."
  type        = number
  default     = 14
}
