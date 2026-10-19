output "queue_url" {
  value = aws_sqs_queue.transactions.url
}

output "queue_arn" {
  value = aws_sqs_queue.transactions.arn
}

output "dead_letter_queue_arn" {
  value = aws_sqs_queue.dead_letter.arn
}

output "consumer_timeout_seconds" {
  description = "Echoes the consumer timeout so the consumer and the queue cannot drift apart."
  value       = var.consumer_timeout_seconds
}
