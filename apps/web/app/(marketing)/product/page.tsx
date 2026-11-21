import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeSample } from '../../../components/marketing/code-sample';
import { repository } from '../../../components/marketing/shared';
import { TerminalFrame } from '../../../components/marketing/terminal-frame';

export const metadata: Metadata = {
  title: 'The payment system, boundary by boundary',
  description:
    'Inspect the shipped Paybox MVP: idempotency, verified credits, signed webhook dedupe, retries and replay, immutable journals, reconciliation, partial refunds and x402.',
};

export default function Product() {
  return (
    <div className="mkt-container product-page">
      <header className="product-intro">
        <p className="mono-label">The shipped MVP · test mode only</p>
        <h1>
          The payment.
          <br />
          The proof.
        </h1>
        <p>
          One merchant API. Two payment rails. Every retry, credit and recovery leaves evidence you can
          inspect.
        </p>
      </header>
      <div className="spec-layout">
        <nav className="spec-rail" aria-label="Product capabilities">
          <a href="#idempotency">
            <span>01</span> Checkout
          </a>
          <a href="#webhooks">
            <span>02</span> Delivery
          </a>
          <a href="#ledger">
            <span>03</span> Ledger
          </a>
          <a href="#reconciliation">
            <span>04</span> Reconciliation
          </a>
          <a href="#x402">
            <span>05</span> x402
          </a>
          <a href="#demo">
            <span>06</span> Run the demo
          </a>
        </nav>
        <div className="spec-sheets">
          <section className="product-sheet" id="idempotency">
            <div className="sheet-copy">
              <p className="mono-label">01 / checkout</p>
              <h2>
                Ask twice.
                <br />
                Pay once.
              </h2>
              <p>
                A double tap on flaky 3G must not become two payments. <code>Idempotency-Key</code> scopes
                retries to one merchant request.
              </p>
              <details className="sheet-detail">
                <summary>
                  <h3>Idempotency</h3>
                </summary>
                <p>
                  Same key and body: stored 201 with <code>Idempotent-Replayed: true</code>. Changed body:{' '}
                  <code>409 idempotency_key_reuse</code>. Demo 0:15 proves one payment ID and one row.
                </p>
              </details>
              <details className="sheet-detail" id="verification">
                <summary>
                  <h3>Verify before credit</h3>
                </summary>
                <p>
                  A redirect or signed webhook is a signal. The worker checks processor success, reference,
                  amount and currency before posting any credit. Demo 0:35: created → pending → succeeded.
                </p>
              </details>
              <Link className="mkt-text-link" href="/payments">
                Inspect payment timelines →
              </Link>
            </div>
            <div className="sheet-visual">
              <TerminalFrame
                path="paybox / checkout"
                image="/images/settlement-payment.webp"
                width={2254}
                height={1300}
                alt="Real test-mode payment with processor verification in its timeline and balanced ledger entries."
              />
              <p className="visual-caption">Actual test-mode payment detail · Captured at 2×</p>
            </div>
          </section>
          <section className="product-sheet sheet-reverse" id="webhooks">
            <div className="sheet-copy">
              <p className="mono-label">02 / event delivery</p>
              <h2>
                Redelivered.
                <br />
                Never re-credited.
              </h2>
              <p>
                Validate signed Paystack webhooks over raw bytes, preserve every receipt and deduplicate each
                business event.
              </p>
              <details className="sheet-detail">
                <summary>
                  <h3>Webhook ingest + dedupe</h3>
                </summary>
                <p>
                  Demo 0:50 delivers <code>charge.success</code> three more times: one processed event, three
                  duplicates, unchanged merchant credit.
                </p>
              </details>
              <details className="sheet-detail" id="delivery">
                <summary>
                  <h3>Outbox, retries, DLQ and replay</h3>
                </summary>
                <p>
                  The notification job commits with the payment. Transient failures retry with jitter; attempt
                  eight becomes DEAD. Replay preserves the history and audits its operator. Delivery is at
                  least once: receivers deduplicate event IDs.
                </p>
              </details>
              <Link className="mkt-text-link" href="/dead-letters">
                Open the dead-letter queue →
              </Link>
            </div>
            <div className="sheet-visual">
              <TerminalFrame
                path="paybox / dead-letter queue"
                image="/images/settlement-dlq.webp"
                width={2254}
                height={1346}
                alt="Actual dead-letter queue with a failed merchant notification, eight attempt records and Replay."
              />
              <p className="visual-caption">Demo 1:05–1:25 · Eight failures, then audited Replay</p>
            </div>
          </section>
          <section className="product-sheet" id="ledger">
            <div className="sheet-copy">
              <p className="mono-label">03 / accounting</p>
              <h2>
                Two sides.
                <br />
                Zero difference.
              </h2>
              <p>
                Every capture, fee and refund posts a balanced journal in the same transaction as the business
                transition.
              </p>
              <details className="sheet-detail">
                <summary>
                  <h3>Immutable double-entry ledger</h3>
                </summary>
                <p>
                  Database constraints enforce equal debits and credits, immutable journal lines and a unique{' '}
                  <code>idempotency_ref</code>. A replay cannot post the same capture twice.
                </p>
              </details>
              <details className="sheet-detail">
                <summary>
                  <h3>Separate currency books</h3>
                </summary>
                <p>
                  NGN is integer kobo. USDC is six-decimal base units. Balances are sums of lines; there is no
                  floating-point money, FX or combined total.
                </p>
              </details>
              <Link className="mkt-text-link" href="/payments">
                Read the payment’s journal →
              </Link>
            </div>
            <div className="sheet-visual">
              <TerminalFrame
                path="paybox / ledger"
                image="/images/settlement-ledger.webp"
                width={850}
                height={716}
                alt="Actual Paybox ledger panel with matching debit and credit totals and a zero difference."
              />
              <p className="visual-caption">Real journal totals from the test-mode walkthrough</p>
            </div>
          </section>
          <section className="product-sheet sheet-reverse" id="reconciliation">
            <div className="sheet-copy">
              <p className="mono-label">04 / finance controls</p>
              <h2>
                Find the drift.
                <br />
                Keep the evidence.
              </h2>
              <p>
                Reconcile nightly at 02:00 Africa/Lagos or on demand. Missing webhooks recover through
                verified transitions; mismatches stay visible.
              </p>
              <details className="sheet-detail">
                <summary>
                  <h3>Reconciliation</h3>
                </summary>
                <p>
                  Demo 1:35: local ₦15,000 versus processor ₦14,500 becomes <code>amount_mismatch</code>.
                  Never silently auto-fixed. A resolution note changes the review record, not the ledger.
                </p>
              </details>
              <details className="sheet-detail" id="refunds">
                <summary>
                  <h3>Concurrent-safe partial refunds</h3>
                </summary>
                <p>
                  A payment-row lock reserves the refundable amount. Demo 1:50 processes ₦5,000, then rejects
                  ₦20,000 with <code>422 refund_exceeds_refundable</code>. Failed refunds release their
                  reservation.
                </p>
              </details>
              <Link className="mkt-text-link" href="/reconciliation">
                Inspect the reconciliation report →
              </Link>
            </div>
            <div className="sheet-visual">
              <TerminalFrame
                path="paybox / reconciliation"
                image="/images/settlement-reconciliation.webp"
                width={1690}
                height={832}
                alt="Actual reconciliation finding: NGN 15,000 locally and NGN 14,500 at the processor, open for review."
              />
              <p className="visual-caption">Actual test data · A mismatch remains open for review</p>
            </div>
          </section>
          <section className="product-sheet" id="x402">
            <div className="sheet-copy">
              <p className="mono-label">05 / paid endpoints</p>
              <h2>
                The request
                <br />
                is the checkout.
              </h2>
              <p>
                Price a route in test USDC. An automated client pays inside HTTP, without a merchant account
                or checkout page.
              </p>
              <details className="sheet-detail">
                <summary>
                  <h3>402 → pay → 200 + receipt</h3>
                </summary>
                <p>
                  <code>PAYMENT-REQUIRED</code> challenges the client; it retries with{' '}
                  <code>PAYMENT-SIGNATURE</code>. Verify, call the upstream, then settle after a 2xx and
                  return <code>PAYMENT-RESPONSE</code>.
                </p>
              </details>
              <details className="sheet-detail">
                <summary>
                  <h3>Consume each authorization once</h3>
                </summary>
                <p>
                  Demo 2:05 rejects replay with <code>402 payment_already_used</code>. Upstream failure never
                  settles; settlement failure never credits. Ambiguous public-facilitator timeouts remain
                  uncredited for investigation.
                </p>
              </details>
              <Link className="mkt-text-link" href="/x402">
                Open priced endpoints and the USDC book →
              </Link>
            </div>
            <div className="sheet-visual">
              <TerminalFrame
                path="paybox / x402 / separate books"
                image="/images/settlement-x402.webp"
                width={2254}
                height={1218}
                alt="Actual paid-endpoint routes and separate NGN and test-USDC ledger books."
              />
              <p className="visual-caption">Offline simulated settlement / Base Sepolia testnet only</p>
            </div>
          </section>
          <section className="product-sheet sheet-reverse" id="demo">
            <div className="sheet-copy">
              <p className="mono-label">06 / inspect the system</p>
              <h2>
                Run it.
                <br />
                Then break it.
              </h2>
              <p>
                The deterministic HTTP walkthrough asserts each payment boundary and stops on failure. Docker
                Compose, Node 22+ and pnpm 10; no keys or wallet setup required.
              </p>
              <details className="sheet-detail" id="operations">
                <summary>
                  <h3>Ops dashboard</h3>
                </summary>
                <p>
                  Timelines, webhook receipts, job attempts, DLQ replay, reconciliation and the x402 tab give
                  operators the full trail.
                </p>
              </details>
              <details className="sheet-detail" id="merchant-api">
                <summary>
                  <h3>Merchant API + OpenAPI</h3>
                </summary>
                <p>
                  Merchant-scoped test keys, integer amounts and RFC 9457 errors. Paystack hosts checkout; no
                  card data enters Paybox.
                </p>
              </details>
              <div className="mkt-actions">
                <a className="mkt-button" href={`${repository}#run-the-complete-demo`}>
                  Read the docs ↗
                </a>
                <Link className="mkt-button mkt-button-secondary" href="/app">
                  Open ops ↗
                </Link>
              </div>
              <a className="mkt-text-link" href="/developers">
                Read the developer guide →
              </a>
            </div>
            <div className="sheet-visual">
              <CodeSample />
              <pre className="demo-commands">
                <code>
                  {'pnpm install --frozen-lockfile\ndocker compose up --build -d\npnpm demo:seed\npnpm demo'}
                </code>
              </pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
