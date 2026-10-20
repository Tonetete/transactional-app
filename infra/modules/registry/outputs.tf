output "repository_url" {
  description = "Image name without tag: <account>.dkr.ecr.<region>.amazonaws.com/<name>-api."
  value       = aws_ecr_repository.api.repository_url
}
