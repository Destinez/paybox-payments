# x402 gateway and a separate USDC book

Status: accepted, 14 November 2026.

A merchant configures a price and an upstream endpoint. Paybox presents the payment challenge, verifies an EIP-3009 authorization, forwards the request with signed payment metadata, and settles only after the upstream returns 2xx. The official resource server and Hono adapter share a facilitator interface; the offline facilitator verifies real EIP-712 signatures, then persists simulated settlement receipts.

A gateway keeps route configuration, replay protection, accounting and notification delivery in one place. Merchants need only verify the timestamped `Paybox-X402-Payment` header. Its `status: verified` means authorization was checked; it does not promise settlement. A client can receive an upstream failure without being charged. Conversely, settlement can fail after the upstream performs work. Upstreams with side effects must deduplicate by the signed payment ID and decide whether to fulfill only upon `x402.payment.settled`.

## Replay and recovery

The unique nonce key covers network, token contract, payer and authorization nonce. An atomic insert claims it before invoking the upstream. Concurrent requests cannot execute or settle twice. A consumed authorization is never released, including after failure: retry with a fresh authorization only after understanding the original outcome. Fake settlement receipts are independently unique on the nonce key.

A successful receipt is persisted with a `finalize_x402` outbox job. Finalization posts the ledger and enqueues `x402.payment.settled` atomically. A database posting failure can be recovered by the worker without repeating the facilitator call. Replaying that job never credits twice.

There is no distributed transaction between Postgres and the public facilitator. If the process dies after submitting settlement but before persisting its receipt, the row remains `settling`; a network error is `settlement_failed` with an explicit unknown-outcome note. These rows require checking the testnet authorization/transaction before any corrective action. Paybox does not blindly resubmit, credit an unconfirmed result, or release the nonce. This boundary is visible in the dashboard. On-chain reconciliation and automatic ambiguous-outcome recovery are future work.

## Accounting

USDC uses integer base units with six decimals. Price limits keep each amount within the ledger's safe integer bound. A successful payment debits `usdc_clearing` and credits the merchant's USDC payable. NGN fees and refunds keep their existing accounts. A database trigger rejects mixed-currency journals and account relabeling; another deferred trigger enforces balance. The dashboard displays each book independently, with no FX or combined total.

## Protocol sources

Checked the official [repository](https://github.com/x402-foundation/x402/tree/1a084343e165d6f61b60b34f6146d6e4a4a7f3ca) and [documentation](https://docs.x402.org) before implementation. Packages `@x402/core`, `@x402/evm`, `@x402/hono` and `@x402/fetch` are pinned to 2.31.0. Protocol v2 uses `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE`. Scheme `exact`, EIP-3009 authorization settlement, network `eip155:84532`, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, and `https://x402.org/facilitator` are fixed for Base Sepolia. Configuration rejects all other networks.

The fake is intentionally offline: it validates authorizations but does not simulate wallet balances, gas or blockchain finality. Simulated hashes are labelled as such in the dashboard; real testnet hashes link to Base Sepolia's explorer.
