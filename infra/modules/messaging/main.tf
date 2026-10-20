locals {
  # AWS guidance for Lambda consumers: at least 6x the function timeout, so a slow bank call is not redelivered mid-flight.
  visibility_timeout_seconds = var.consumer_timeout_seconds * 6
}

resource "aws_sqs_queue" "dead_letter" {
  name                      = "${var.name}-transactions-dlq"
  sqs_managed_sse_enabled   = true
  message_retention_seconds = var.dlq_retention_days * 24 * 3600
}

resource "aws_sqs_queue" "transactions" {
  name                       = "${var.name}-transactions"
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = local.visibility_timeout_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# Reject any request that does not use TLS.
data "aws_iam_policy_document" "tls_only" {
  for_each = {
    transactions = aws_sqs_queue.transactions.arn
    dead_letter  = aws_sqs_queue.dead_letter.arn
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["sqs:*"]
    resources = [each.value]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_sqs_queue_policy" "transactions" {
  queue_url = aws_sqs_queue.transactions.url
  policy    = data.aws_iam_policy_document.tls_only["transactions"].json
}

resource "aws_sqs_queue_policy" "dead_letter" {
  queue_url = aws_sqs_queue.dead_letter.url
  policy    = data.aws_iam_policy_document.tls_only["dead_letter"].json
}
