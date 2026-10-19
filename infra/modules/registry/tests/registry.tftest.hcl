mock_provider "aws" {}

variables {
  name         = "test"
  protect_data = true
}

run "repository_scans_on_push_and_is_encrypted" {
  command = apply

  assert {
    condition     = aws_ecr_repository.api.name == "test-api" && one(aws_ecr_repository.api.image_scanning_configuration).scan_on_push && one(aws_ecr_repository.api.encryption_configuration).encryption_type == "AES256"
    error_message = "Repository must be named <name>-api, scan on push and be encrypted"
  }
}

run "protected_repository_is_not_force_deleted" {
  command = apply

  assert {
    condition     = !aws_ecr_repository.api.force_delete
    error_message = "A protected repository must keep its images"
  }
}

run "disposable_repository_is_force_deleted" {
  command = apply
  variables {
    protect_data = false
  }

  assert {
    condition     = aws_ecr_repository.api.force_delete
    error_message = "A disposable repository must be deletable with images in it"
  }
}
