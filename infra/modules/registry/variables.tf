variable "name" {
  description = "Prefix for the repository name."
  type        = string
}

variable "protect_data" {
  description = "True keeps the repository (and its images) when it is destroyed while images remain; false force-deletes it."
  type        = bool
}
