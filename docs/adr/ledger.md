# Immutable, balanced journals

Status: accepted.

Every movement is a journal with positive integer lines across distinct accounts. A deferred Postgres constraint trigger verifies equal debits and credits at commit. Triggers reject updates or deletes of journals and lines. Account identity is immutable; every line must use the journal's currency. Corrections require new reversing entries.

A capture debits processor clearing and credits merchant payable. Merchant-borne fees debit merchant payable and credit clearing. Refund requests reserve value by moving it from payable to refunds in transit. A processed refund clears the reservation against processor clearing; a failed refund releases it. Payment-row locking serializes refund reservations so concurrent requests cannot exceed the refundable amount.

Each business posting has a unique idempotency reference, making repeated worker execution safe. Balances are sums of lines, never mutable account balances. NGN uses kobo; x402 uses a separate USDC book in millionths of a token. No conversion occurs between them.

The application caps individual amounts below the safe-integer boundary and validates with bigint arithmetic. Postgres stores bigint amounts and checks the same bounds. Paystack's unsigned 64-bit identifiers use numeric(20,0) strings, since they cannot safely fit either JavaScript numbers or signed Postgres bigint at the upper end.
