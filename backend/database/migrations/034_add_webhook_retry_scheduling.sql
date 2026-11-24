-- Add fields to webhook_dead_letter_queue for exponential backoff retry scheduling
ALTER TABLE webhook_dead_letter_queue
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Add index for status + next_retry_at to efficiently query retryable webhooks
CREATE INDEX IF NOT EXISTS idx_webhook_dlq_status_retry ON webhook_dead_letter_queue(status, next_retry_at);
