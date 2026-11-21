# Paybox Payments

[![CI](https://github.com/Destinez/paybox-payments/actions/workflows/ci.yml/badge.svg)](https://github.com/Destinez/paybox-payments/actions/workflows/ci.yml)

A payment operations service for Nigerian commerce platforms. Paybox sits between a merchant and Paystack: it creates checkout links, verifies money movement, posts immutable double-entry journals, delivers signed notifications, and reconciles missing or inconsistent processor records. Merchants can also sell API access per request using x402 and test USDC.

Built by **Obaro Destiny Udurie**, a full-stack engineer in Lagos. Paystack **test mode** and Base Sepolia **testnet** only. No card data passes through this service.

![Payment operations dashboard](docs/images/dashboard.png)

## Run the complete demo

Requirements: Docker Compose, Node 22 or later, and pnpm 10. The fake processors run offline after dependencies and container images have been downloaded. No keys or wallet setup are needed.

```sh
corepack enable
pnpm install --frozen-lockfile
docker compose up --build -d
pnpm demo:seed
pnpm demo
```

Open **http://localhost:3000** for the public site and interactive test-payment example. The developer guide at **/developers** works without the API. Sign in to the operations workspace at **/app**. Generated admin/viewer logins and the merchant API key are in `.local/demo.json`, outside version control. Postgres listens on port 5433, the API on 4000, and the example merchant receiver on 4100. Compose applies migrations before starting the API and worker. The demo detects whether its upstream receiver runs on the host or the Compose network.

`pnpm demo` runs the complete walkthrough through HTTP, including the worker and receiver. It checks the actual outcomes and stops on failure:

1. Create one ₦15,000 payment twice with the same key; get the same 201 response. Change the amount and get 409. Complete fake checkout and wait for verification and a balanced capture.
2. Deliver the same signed webhook three more times. The ledger remains unchanged.
3. Make the receiver return 500. A second payment's notification retries eight times with jitter, then becomes dead.
4. Restore the receiver and replay the job. Delivery succeeds; history and the operator audit remain.
5. Make the processor report ₦14,500 against the local ₦15,000. Reconciliation flags the difference without changing either record.
6. Refund ₦5,000 and wait for processing. Reject a ₦20,000 refund with 422.
7. Request a priced endpoint: 402 challenge, paid 200 with receipt, then 402 on replay.

![Demo walkthrough](docs/images/demo.gif)

For a live walkthrough, run the numbered scripts in `scripts/demo/` individually. After `03-break-merchant.sh`, restore the receiver with `curl -X POST http://localhost:4100/control -H 'Content-Type: application/json' -d '{"fail":false}'`, then click **Replay** in the dashboard. `04-drift.sh` runs reconciliation and the partial-refund checks. `05-agent-pays.sh` runs just the x402 step. Each fresh run creates new payments and retains the previous audit trail; repeat runs may therefore show earlier reconciliation findings.

## Get paid by automated clients (x402)

In **Paid endpoints**, an admin sets a method, path, upstream URL, price and Base Sepolia recipient. The client needs no merchant account or API key. It signs an EIP-3009 authorization and retries the request with `PAYMENT-SIGNATURE`. The gateway verifies it, calls the upstream with signed metadata, settles after a 2xx, and records the payment in its own USDC book.

```mermaid
sequenceDiagram
  participant C as Client
  participant P as Paybox gateway
  participant F as Facilitator
  participant U as Merchant upstream
  participant L as Ledger / outbox
  C->>P: GET priced endpoint
  P-->>C: 402 + PAYMENT-REQUIRED
  C->>P: Retry + PAYMENT-SIGNATURE
  P->>F: Verify authorization
  P->>U: Request + signed payment metadata
  U-->>P: 2xx + data
  P->>F: Settle authorization
  F-->>P: Settlement receipt
  P->>L: Balanced USDC entry + notification
  P-->>C: 200 + PAYMENT-RESPONSE + data
```

The seed prices `GET /x402/m/demo-store/v1/stock` at **0.01 USDC**. `X402_MODE=fake` verifies real signatures with an ephemeral key and persists simulated receipts. `X402_MODE=testnet` uses the public x402.org facilitator. Only `eip155:84532` and Base Sepolia's USDC contract are accepted. NGN uses kobo; USDC uses six-decimal base units. Neither uses floating-point money calculations, and their totals are never combined.

![Paid endpoints and separate books](docs/images/x402.png)

A unique key over network, token, payer and nonce consumes each authorization once. Concurrent double-submission invokes the upstream and settles once. Upstream failure never settles; settlement failure never credits. A confirmed receipt and its finalization job commit together, so ledger-posting failure can be recovered without another settlement call. `x402.payment.settled` uses the existing signed outbox delivery.

The `Paybox-X402-Payment` header is `t=<unix>,v1=<HMAC-SHA512>,data=<base64url JSON>`. Verify the HMAC over `t.JSON`, require a timestamp within five minutes, and deduplicate the signed payment ID for upstream side effects. The metadata includes payer, route, amount, network and a request hash. The signing secret is shown once when first registering a route; configuring the merchant webhook endpoint rotates that same secret.

To exercise the real facilitator, register an HTTPS upstream and your testnet recipient, set `X402_MODE=testnet`, and provide a throwaway `X402_DEMO_PRIVATE_KEY` with test USDC through the environment. Set `X402_DEMO_PATH` to your registered gateway path, then run `pnpm demo:x402`. No private key is written to disk. Mainnet configuration is rejected.

## Architecture

```mermaid
flowchart LR
  Merchant[Merchant backend] -->|API key + Idempotency-Key| API[Hono API]
  Customer[Customer browser] -->|Hosted checkout| Processor[Paystack test / local fake]
  Processor -->|Signed webhook| API
  Client[Paid API client] -->|x402| API
  API -->|Verify and settle| Facilitator[Testnet / offline facilitator]
  API -->|Signed proxy request| Upstream[Merchant upstream]
  API --> DB[(Postgres 16)]
  Worker[Outbox worker + scheduler] --> DB
  Worker -->|Verify and refund| Processor
  Worker -->|Signed notification| Merchant
  Dashboard[Next.js dashboard] -->|Session + CSRF| API
```

The pnpm workspace contains `apps/api` (Hono, API and worker processes), `apps/web` (Next.js App Router), `packages/db` (Drizzle schema, migrations and ledger), and `packages/shared` (schemas, signatures, retry policy and pure state machines). The existing Hono foundation was retained. The worker is a separate process using the same database and services.

### Idempotency and webhook ingestion

Merchant-scoped idempotency records store the hash of method, path and canonical JSON. A locked claim protects initialization; recovery links retain the local payment if the process fails after calling the processor. Same key and body returns the stored status/body with `Idempotent-Replayed: true`; a different body gets 409. Infrastructure failures are not cached. Expired records are purged after 24 hours.

Paystack payloads have no top-level event ID. Paybox hashes the event type, provider object identity and status, with a unique database constraint. Raw bytes and their hash are preserved; each redelivery gets its own receipt. Both the timestamped `Paystack-Signature` scheme and explicitly enabled legacy `x-paystack-signature` validate over raw bytes with constant-time comparisons. Current signatures support secret rotation and a 300-second timestamp tolerance.

```mermaid
sequenceDiagram
  participant M as Merchant
  participant A as API
  participant P as Paystack
  participant D as Postgres
  participant W as Worker
  M->>A: Create payment + Idempotency-Key
  A->>D: Claim key and create local payment
  A->>P: Initialize checkout with fixed reference
  A->>D: Store pending payment and response
  A-->>M: 201 + authorization_url
  P->>A: Signed charge.success
  A->>D: Event + outbox job in one transaction
  A-->>P: 200
  W->>P: Verify reference
  W->>D: Succeeded + balanced journal + notification job
  W->>M: Signed payment.succeeded
```

### Reliable processing and accounting

The outbox commits with each business transition. Workers lease jobs with `FOR UPDATE SKIP LOCKED`, renew leases, and fence stale completions. Network failures, 408, 429 and 5xx retry with full-jitter exponential backoff; `Retry-After` is honored. Eight failures exhaust the budget. Manual replay preserves attempts and audits its operator. Delivery is at least once: merchant receivers must deduplicate stable event IDs.

Only processor verification matching the reference, amount and currency can credit a merchant. Deferred database triggers require balanced journals across distinct accounts; other triggers prevent rewriting journals, lines or account identity. Fees are borne by the merchant. Refunds reserve funds under a payment-row lock, then either settle or release the reservation. Concurrent refunds cannot reserve more than the paid amount.

Reconciliation runs nightly at 02:00 Africa/Lagos and on demand. It checkpoints progress, rate-limits verification, heals a missing webhook through the same verified transition, and flags amount/status/ledger discrepancies. An operator must provide a note to resolve a finding. Resolution changes the review record, not the ledger.

Decision records: [outbox](docs/adr/outbox.md), [verify before credit](docs/adr/verify-before-credit.md), [ledger](docs/adr/ledger.md), [x402 gateway](docs/adr/x402-gateway.md).

## Develop without containers for the applications

```sh
docker compose up -d postgres
DATABASE_URL=postgres://paybox:paybox@localhost:5433/paybox pnpm db:migrate
DEMO_MODE=true pnpm --filter api dev
# Separate terminals:
DEMO_MODE=true pnpm worker
pnpm --filter @paybox/web dev
node examples/merchant-receiver/server.mjs
pnpm demo:seed
pnpm demo
```

The API generates persistent development-only secrets in fake mode. The `.env.example` file documents all settings; real secrets must be supplied through the environment. `pnpm worker` starts the same worker used by Compose. Set `DEMO_MODE=true` for compressed retries (200ms base, 2s cap); ordinary retries use 2s base and 10min cap.

## Use Paystack test keys

Use a fresh database for a real test account. Set `PAYSTACK_MODE=test`, `PAYSTACK_SECRET_KEY` to your test key, `PAYSTACK_WEBHOOK_SECRETS` to comma-separated `whsec_` values, `SESSION_SECRET` to a random value of at least 32 characters, and `DATA_KEY` to 32 random bytes encoded as base64. `openssl rand -hex 32` and `openssl rand -base64 32` generate the latter settings. Export these in your shell or secret manager before starting Compose. Every process refuses live keys.

Set `API_PUBLIC_URL` and `WEB_URL` to your reachable test deployment URLs. Register `POST <API_PUBLIC_URL>/webhooks/paystack` in Paystack. Initialize the database and run `pnpm bootstrap` with the same database environment to create an admin and merchant. Credentials are written once to `.local/setup.json`; `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_MERCHANT_NAME` and `BOOTSTRAP_MERCHANT_SLUG` can customize the initial records. With Compose, pass its published database URL when running the bootstrap command on the host.

Success card: **4084 0840 8408 4081**, CVV **408**, any future expiry. Declined: **4084 0800 0000 5408**, CVV **001**. Insufficient funds: **4084 0800 0067 0037**, CVV **787**. Checkout is hosted by Paystack; Paybox never receives card details.

The provider contract suite additionally targets Paystack test mode when `PAYSTACK_SECRET_KEY` is present. The deterministic demo's fault injection requires fake mode. Real test-provider calls are optional and are not needed in CI.

## API, security and operations

OpenAPI: **http://localhost:4000/v1/openapi.json**. The schema includes merchant operations, dashboard endpoints and the x402 gateway. Integration tests validate the document and compare it to the registered routes. API errors use RFC 9457 Problem Details.

Merchant API keys are hashed and scoped to one merchant. Postgres token buckets allow 120 requests/minute per key and ten login attempts per fifteen minutes per connection address and normalized email. Forwarded addresses are not trusted. HTTP 429 carries `Retry-After`. Sessions use HttpOnly cookies, CSRF checks and admin/ops/viewer permissions. Customer email is masked in lists and for viewers. Secrets and request bodies are omitted from structured logs.

`/healthz` checks process liveness. `/readyz` requires the exact migration checksums for this checkout. `/metrics` exposes request counts/latency, idempotency replays, webhook outcomes, durable worker attempts, DLQ depth and reconciliation findings. Worker metrics come from Postgres and remain visible to the API process. HTTP metrics reset on API restart. `X-Request-Id` identifies one exchange; `X-Correlation-Id` follows the original payment through events, jobs and merchant notifications.

The example receiver and fake fault controls are local demonstration surfaces. Compose binds published ports to loopback. A hosted installation should use test providers, HTTPS, restricted administrative access, and an internal metrics endpoint. The outbound HTTP clients pin validated DNS addresses, reject private destinations outside the explicit local demo receiver, cap response size and enforce timeouts.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
docker compose -f compose.test.yaml up -d
pnpm test:integration
pnpm test:coverage
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Tests cover signatures and rotation, concurrent idempotency, ledger invariants, webhook replay, retry budgets, lease recovery, concurrent refunds, reconciliation, roles/CSRF, rate limits, migration readiness, x402 failure boundaries, and accessible desktop/mobile views. Coverage requires shared code ≥90% lines and API code ≥80%; process entry points are excluded. Integration and browser tests reset a dedicated database whose name must end in `_test` (default port 55432).

Playwright normally starts the API, worker, receiver and production dashboard against that test database. To test a running Compose stack, seed it first and run `E2E_EXTERNAL=true pnpm test:e2e`. Browser artifacts live in ignored `.local/` and `test-results/`. The GitHub Actions workflow runs lint, typecheck, coverage with a Postgres service, build, Playwright and a secret scan; its badge becomes active after this repository is published.

## Boundaries

This is a test-mode service, with no live payments, payouts, subscriptions, FX or card storage. The offline facilitator validates signatures but does not model wallet balances, gas or chain finality. A public-facilitator timeout can leave settlement ambiguous: the nonce stays consumed and the row requires testnet investigation. Confirmed receipts recover automatically; ambiguous external outcomes are never blindly credited or resubmitted. See the x402 decision record for that distributed-transaction boundary.

MIT · Copyright Obaro Destiny Udurie.
