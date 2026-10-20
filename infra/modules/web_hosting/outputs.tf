output "bucket_name" {
  description = "Upload the static export here."
  value       = aws_s3_bucket.this.bucket
}

output "url" {
  value = "https://${aws_cloudfront_distribution.this.domain_name}"
}

output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}
