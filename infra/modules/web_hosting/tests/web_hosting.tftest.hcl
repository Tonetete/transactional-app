mock_provider "aws" {
  # The provider validates ARNs even on mocked values.
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::mock" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = { arn = "arn:aws:cloudfront::111111111111:distribution/MOCK" }
  }
}

variables {
  name         = "test"
  protect_data = true
}

run "bucket_is_private_encrypted_and_only_cloudfront_reads_it" {
  command = apply

  assert {
    condition     = aws_s3_bucket_public_access_block.this.block_public_acls && aws_s3_bucket_public_access_block.this.block_public_policy && aws_s3_bucket_public_access_block.this.ignore_public_acls && aws_s3_bucket_public_access_block.this.restrict_public_buckets
    error_message = "All public access must be blocked"
  }
  assert {
    condition     = one(one(aws_s3_bucket_server_side_encryption_configuration.this.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"
    error_message = "Bucket must be encrypted"
  }
  assert {
    condition     = [for s in jsondecode(aws_s3_bucket_policy.this.policy).Statement : s.Principal.Service if s.Effect == "Allow"][0] == "cloudfront.amazonaws.com"
    error_message = "Only CloudFront may read the bucket"
  }
  assert {
    condition     = contains([for s in jsondecode(aws_s3_bucket_policy.this.policy).Statement : s.Effect if s.Sid == "DenyInsecureTransport"], "Deny")
    error_message = "Non-TLS requests must be denied"
  }
}

run "distribution_serves_the_static_site_with_the_exported_404_page" {
  command = apply

  assert {
    condition     = aws_cloudfront_distribution.this.default_root_object == "index.html" && one(aws_cloudfront_distribution.this.default_cache_behavior).viewer_protocol_policy == "redirect-to-https"
    error_message = "index.html root and HTTPS redirect expected"
  }
  assert {
    condition     = toset([for r in aws_cloudfront_distribution.this.custom_error_response : r.error_code]) == toset([403, 404]) && alltrue([for r in aws_cloudfront_distribution.this.custom_error_response : r.response_code == 404 && r.response_page_path == "/404.html"])
    error_message = "403 and 404 must show the exported 404 page"
  }
  assert {
    condition     = length(aws_cloudfront_distribution.this.ordered_cache_behavior) == 0 && length(aws_cloudfront_distribution.this.origin) == 1
    error_message = "No API behavior unless an api_origin is given"
  }
}

run "api_origin_routes_v1_to_the_api_with_every_method_and_no_cache" {
  command = apply
  variables {
    api_origin = { domain_name = "localhost" }
  }

  assert {
    condition     = length(aws_cloudfront_distribution.this.ordered_cache_behavior) == 1 && [for b in aws_cloudfront_distribution.this.ordered_cache_behavior : b.path_pattern][0] == "/v1/*"
    error_message = "/v1/* must have its own behavior"
  }
  assert {
    condition     = toset([for b in aws_cloudfront_distribution.this.ordered_cache_behavior : b.allowed_methods][0]) == toset(["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"])
    error_message = "All methods must reach the API"
  }
  assert {
    condition     = [for b in aws_cloudfront_distribution.this.ordered_cache_behavior : b.cache_policy_id][0] == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    error_message = "API responses must not be cached"
  }
}

run "protected_bucket_is_kept_on_destroy" {
  command = apply

  assert {
    condition     = !aws_s3_bucket.this.force_destroy
    error_message = "A protected bucket must not be force-destroyed"
  }
}

run "disposable_bucket_can_be_destroyed" {
  command = apply
  variables {
    protect_data = false
  }

  assert {
    condition     = aws_s3_bucket.this.force_destroy
    error_message = "A disposable bucket must be emptied and deleted on destroy"
  }
}
