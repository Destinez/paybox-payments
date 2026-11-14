# Verify before crediting a merchant

Status: accepted.

A signed `charge.success` proves the message came from the configured processor. It does not independently establish the correct amount, currency, or local order. Ingestion stores the raw bytes and signature metadata, deduplicates the semantic event, and acknowledges quickly. The worker then verifies the reference through the processor API.

A payment can become succeeded only when verification reports success and its amount, currency and reference match the immutable local identity. Fees are posted separately and borne by the merchant. A mismatch remains visible for reconciliation; it never silently adjusts the order or ledger. A delayed verified success can recover an abandoned payment.

This adds a network round trip to final confirmation. The checkout returning to the dashboard is therefore not proof of payment: the dashboard may briefly show pending while the worker verifies. That delay is preferable to crediting unverified funds. Reconciliation also uses this same transition path to heal a missing webhook, preserving the ledger's idempotency guarantee.
