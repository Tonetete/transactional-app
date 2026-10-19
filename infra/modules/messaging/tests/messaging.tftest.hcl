mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

variables {
  name = "test"
}

run "failed_messages_go_to_the_dlq_after_three_receives" {
  command = apply

  assert {
    condition     = jsondecode(aws_sqs_queue.transactions.redrive_policy).maxReceiveCount == 3
    error_message = "maxReceiveCount must default to 3"
  }
}

run "visibility_timeout_is_six_times_the_consumer_timeout" {
  command = apply
  variables {
    consumer_timeout_seconds = 20
  }

  assert {
    condition     = aws_sqs_queue.transactions.visibility_timeout_seconds == 120
    error_message = "Visibility timeout must be 6x the consumer timeout"
  }
}

run "queues_are_encrypted_and_dlq_kept_14_days" {
  command = apply

  assert {
    condition     = aws_sqs_queue.transactions.sqs_managed_sse_enabled && aws_sqs_queue.dead_letter.sqs_managed_sse_enabled
    error_message = "Both queues must use SQS-managed encryption"
  }
  assert {
    condition     = aws_sqs_queue.dead_letter.message_retention_seconds == 14 * 24 * 3600
    error_message = "DLQ retention must be 14 days"
  }
}

run "queues_reject_non_tls_requests" {
  command = apply

  assert {
    condition = alltrue([
      for p in data.aws_iam_policy_document.tls_only :
      p.statement[0].effect == "Deny" && one(p.statement[0].condition).variable == "aws:SecureTransport"
    ])
    error_message = "Both queues must deny non-TLS requests"
  }
}
