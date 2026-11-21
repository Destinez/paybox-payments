import type { Metadata } from 'next';
import Link from 'next/link';
import { PageIntro, repository } from '../../../components/marketing/shared';

export const metadata: Metadata = {
  title: 'About Obaro and Paybox',
  description:
    'Paybox is the portfolio flagship of Obaro Destiny Udurie, a full-stack engineer in Lagos, built around reliable payments and inspectable accounting.',
};

export default function About() {
  return (
    <div className="mkt-container">
      <PageIntro label="The story behind the workspace" title="Built in Lagos. Built to be understood.">
        Paybox is a portfolio flagship by Obaro Destiny Udurie: a complete product built around the hard parts
        of payment operations.
      </PageIntro>
      <div className="doc-layout">
        <aside className="doc-rail builder-rail">
          <p className="mono-label">Builder</p>
          <h2>Obaro Destiny Udurie</h2>
          <p>Full-stack engineer</p>
          <p>Lagos, Nigeria</p>
          <a href="https://github.com/Destinez">GitHub profile →</a>
        </aside>
        <article className="doc-copy">
          <section id="why">
            <h2>
              <span className="doc-num">01</span>
              Why a payments product?
            </h2>
            <p>
              A successful checkout is only the beginning. Requests get repeated. Webhooks arrive late. A
              merchant’s backend goes offline. A processor record and a local balance can disagree.
            </p>
            <p>
              I built Paybox to make that entire story visible. The API and worker handle the transition; the
              ledger accounts for it; the dashboard gives an operator enough evidence to decide what happens
              next.
            </p>
          </section>
          <section id="portfolio">
            <h2>
              <span className="doc-num">02</span>
              The portfolio is the whole system
            </h2>
            <p>
              This project brings the engineering and the product together: hosted test checkout, signed
              notifications, immutable accounting, resumable reconciliation, operations permissions and paid
              API endpoints.
            </p>
            <p>
              The demo deliberately introduces failures. You can replay a webhook, exhaust a retry budget,
              recover a delivery and inspect an amount mismatch. I kept charge verification separate from
              merchant notification delivery: when a receiver goes offline, the operator can replay its
              message without creating a second charge.
            </p>
            <Link href="/#test-payment" className="mkt-text-link">
              Explore that payment record →
            </Link>
          </section>
          <section id="boundary">
            <h2>
              <span className="doc-num">03</span>A clear boundary
            </h2>
            <p>
              Paybox uses Paystack test mode and Base Sepolia testnet only. It is a demonstration, not a live
              financial service. The source is published under the MIT license so the design and its tradeoffs
              can be inspected.
            </p>
            <div className="mkt-actions">
              <a className="mkt-button" href={repository}>
                Explore the repository →
              </a>
              <Link className="mkt-button mkt-button-secondary" href="/contact">
                Get in touch
              </Link>
            </div>
          </section>
          <section id="principles">
            <h2>
              <span className="doc-num">04</span>
              How the work is judged
            </h2>
            <p>
              Evidence over guesswork. References, receipts, attempts and journals tell one connected story.
            </p>
            <p>
              Recovery is part of the flow. Retries, replay and reconciliation belong in the product from the
              beginning.
            </p>
            <p>
              Honest boundaries. Test providers, separate currency books and visible limitations keep the demo
              clear.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
