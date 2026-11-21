import type { Metadata } from 'next';
import Link from 'next/link';
import { DemoNote, PageIntro, repository } from '../../../components/marketing/shared';

export const metadata: Metadata = {
  title: 'Self-host the demo or discuss a pilot',
  description:
    'Run the complete open-source Paybox test-mode demo yourself, inspect the operations workspace or contact the builder to discuss a pilot integration.',
};

export default function Pricing() {
  return (
    <div className="mkt-container">
      <PageIntro label="Run Paybox" title="Self-host. Inspect. Talk to the builder.">
        The complete MVP is available under the MIT license. Start with the demo, then discuss what your
        integration needs.
      </PageIntro>
      <DemoNote />
      <div className="spec-rows">
        <section>
          <p className="mono-label">01</p>
          <div>
            <h2>Self-host the complete demo</h2>
            <p>
              API, worker, Postgres, dashboard and offline processor fakes. Run the same idempotency,
              delivery, refund and x402 checks used in the walkthrough. You provide the hosting.
            </p>
            <div className="mkt-actions">
              <Link className="mkt-button" href="/product#demo">
                Run the demo <span aria-hidden="true">→</span>
              </Link>
              <a className="mkt-text-link" href={repository}>
                Source and setup guide →
              </a>
            </div>
          </div>
        </section>
        <section>
          <p className="mono-label">02</p>
          <div>
            <h2>Discuss a pilot</h2>
            <p>
              Talk through merchant checkout, webhook delivery or per-request API access. Scope and commercial
              terms would be agreed directly; this demo does not sell subscriptions or process live funds.
            </p>
            <Link className="mkt-button mkt-button-secondary" href="/contact">
              Contact the builder →
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
