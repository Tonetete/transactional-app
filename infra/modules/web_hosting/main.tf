# Hosting for the statically exported Next.js app: a private S3 bucket behind CloudFront (origin access control).
# Content is uploaded out of band (scripts/floci-web-deploy.sh), not by Terraform.

locals {
  bucket_name = coalesce(var.bucket_name, "${var.name}-web")

  # AWS-managed policies have fixed, account-independent ids.
  caching_optimized             = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  caching_disabled              = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  all_viewer_except_host_header = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  api_path_pattern              = "/v1/*"
  all_methods                   = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
}

resource "aws_s3_bucket" "this" {
  bucket        = local.bucket_name
  force_destroy = !var.protect_data
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "this" {
  name                              = "${var.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  default_root_object = "index.html"

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.this.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.this.id
  }

  dynamic "origin" {
    for_each = var.api_origin == null ? [] : [var.api_origin]
    content {
      origin_id   = "api"
      domain_name = origin.value.domain_name
      custom_origin_config {
        http_port              = origin.value.http_port
        https_port             = 443
        origin_protocol_policy = "http-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  default_cache_behavior {
    target_origin_id       = "web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = local.caching_optimized
  }

  dynamic "ordered_cache_behavior" {
    for_each = var.api_origin == null ? [] : [local.api_path_pattern]
    content {
      path_pattern             = ordered_cache_behavior.value
      target_origin_id         = "api"
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = local.all_methods
      cached_methods           = ["GET", "HEAD"]
      cache_policy_id          = local.caching_disabled
      origin_request_policy_id = local.all_viewer_except_host_header
    }
  }

  # A private bucket answers 403 for a missing key; show the exported 404 page for both.
  dynamic "custom_error_response" {
    for_each = [403, 404]
    content {
      error_code         = custom_error_response.value
      response_code      = 404
      response_page_path = "/404.html"
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Only this distribution may read the bucket, and only over TLS.
resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontRead"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.this.arn}/*"
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.this.arn } }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.this]
}
