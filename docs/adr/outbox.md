# A transactional outbox before a separate queue

Status: accepted.

A successful payment transition and its notification job commit in the same Postgres transaction. A broker publish after commit would leave a failure window in which the payment succeeds but the notification disappears. Publishing before commit could notify about a rolled-back payment. The outbox removes that dual write.

Workers lease ten jobs at a time using `FOR UPDATE SKIP LOCKED`. Every lease has a unique owner, an expiry and a heartbeat; stale workers cannot overwrite a newer owner's completion. Database time controls availability and expiry, avoiding clock skew between containers. Handler side effects still need idempotency because a process can die after delivering a webhook but before acknowledging its job.

Retryable network failures, 408, 429 and 5xx use full-jitter exponential backoff: a random delay from zero to `min(cap, base × 2^(attempt−1))`, honoring `Retry-After`. Eight attempts exhaust the budget. Other 4xx, invalid payloads and illegal transitions become dead immediately. Replay resets the budget, preserves the complete history, and records the operator in the audit log.

This keeps deployment small and makes pending work queryable alongside payments. At higher throughput a broker could carry outbox rows to specialized workers; the database transaction would remain the source of delivery intent. Consumers must still deduplicate the stable event ID.
