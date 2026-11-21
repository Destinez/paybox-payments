import { ArrowDownRight, ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PaymentRecord } from '../../components/marketing/payment-record';

export const metadata: Metadata = {
  title: 'Recover delivery. Keep the charge intact.',
  description:
    'Explore a verified ₦15,000 test payment. See how Paybox recovers a merchant notification without creating a new charge or rewriting the ledger.',
};

export default function Home() {
  return (
    <>
      <section className="trace-hero" aria-labelledby="trace-title">
        <div className="mkt-container trace-grid">
          <div className="trace-copy">
            <p className="trace-kicker">
              <i aria-hidden="true" /> Payment operations <span>/</span> Test mode
            </p>
            <h1 id="trace-title">
              Recover delivery.
              <br />
              <em>Keep the charge intact.</em>
            </h1>
            <p className="trace-lead">
              Paybox connects Paystack to your merchant backend. Follow a verified payment and retry its
              failed notification without charging the customer again.
            </p>
            <div className="mkt-actions">
              <a className="mkt-button" href="#test-payment">
                Explore the test payment <ArrowDownRight size={18} aria-hidden="true" />
              </a>
              <Link className="trace-link" href="/developers">
                Developer guide <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
          <PaymentRecord />
        </div>
      </section>
      <section className="mkt-container proof-section" aria-labelledby="ledger-heading">
        <div>
          <p className="mono-label">01 / The ledger</p>
          <h2 id="ledger-heading">
            One charge.
            <br />
            One journal.
          </h2>
          <p>
            Replaying a notification does not post another capture. The same ₦15,000 remains accounted for on
            both sides of the journal.
          </p>
          <Link className="mkt-text-link" href="/product#ledger">
            Inspect the accounting →
          </Link>
        </div>
        <div className="balance-proof">
          <p className="proof-caption">
            Capture journal <span>NGN · Example</span>
          </p>
          <dl>
            <div>
              <dt>Total debits</dt>
              <dd>₦15,000</dd>
            </div>
            <div>
              <dt>Total credits</dt>
              <dd>₦15,000</dd>
            </div>
            <div className="proof-total">
              <dt>Difference</dt>
              <dd>₦0.00</dd>
            </div>
          </dl>
        </div>
      </section>
      <section className="mismatch-band" aria-labelledby="match-heading">
        <div className="mkt-container proof-section">
          <div>
            <p className="mono-label">02 / Reconciliation</p>
            <h2 id="match-heading">Find the difference.</h2>
            <p>
              In this test scenario the processor reports a different amount. Paybox flags it for review
              instead of silently rewriting either record.
            </p>
            <Link className="mkt-text-link" href="/product#reconciliation">
              See the reconciliation report →
            </Link>
          </div>
          <div className="balance-proof mismatch-proof">
            <p className="proof-caption">
              Amount check <span>Needs review</span>
            </p>
            <dl>
              <div>
                <dt>Paybox record</dt>
                <dd>₦15,000</dd>
              </div>
              <div>
                <dt>Processor record</dt>
                <dd>₦14,500</dd>
              </div>
              <div className="proof-total">
                <dt>Difference</dt>
                <dd>₦500</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
      <section className="mkt-container dev-entry" aria-labelledby="dev-heading">
        <p className="mono-label">03 / For developers</p>
        <h2 id="dev-heading">Inspect the implementation.</h2>
        <div className="dev-paths">
          <Link href="/developers">
            <strong>
              Integrate a test checkout <ArrowRight size={18} aria-hidden="true" />
            </strong>
            <span>Request shape, idempotency and local setup.</span>
          </Link>
          <Link href="/product#x402">
            <strong>
              Price an API call <ArrowRight size={18} aria-hidden="true" />
            </strong>
            <span>A separate HTTP payment flow using test USDC.</span>
          </Link>
        </div>
      </section>
      <section className="mkt-container mkt-closing">
        <div>
          <p className="mono-label">Your environment</p>
          <h2>Run the full demo.</h2>
        </div>
        <Link className="mkt-button" href="/product#demo">
          Get the setup guide <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
    </>
  );
}
