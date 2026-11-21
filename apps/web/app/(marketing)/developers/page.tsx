import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeSample } from '../../../components/marketing/code-sample';
import { DemoNote, PageIntro, repository } from '../../../components/marketing/shared';

export const metadata: Metadata = {
  title: 'Developer guide',
  description:
    'Start a test checkout, understand same-key replay, and run the complete Paybox demo locally. No live funds or API connection required to read this guide.',
};

export default function Developers() {
  return (
    <div className="mkt-container">
      <PageIntro label="Developers / Getting started" title="Your first test payment.">
        Start with a merchant-scoped request. Follow it from a checkout link to a verified charge, a balanced
        journal and a signed merchant notification.
      </PageIntro>
      <DemoNote />
      <div className="guide-grid">
        <section>
          <p className="mono-label">01 / Checkout</p>
          <h2>Create once. Retry safely.</h2>
          <p>
            Send a test merchant key and an Idempotency-Key with your request. Amounts are integers in kobo:
            1,500,000 represents ₦15,000.
          </p>
          <p>
            Retry the same request with the same key to receive the stored result. A different body with that
            key returns a conflict, not a new checkout.
          </p>
          <Link href="/product#idempotency" className="mkt-text-link">
            Explore checkout and verification →
          </Link>
        </section>
        <CodeSample />
      </div>
      <section className="dev-entry">
        <p className="mono-label">02 / Local setup</p>
        <h2>Run the complete demo.</h2>
        <p>
          Use Node 22 or later, pnpm 10 and Docker Compose in a local clone. The offline walkthrough needs no
          Paystack or wallet credentials.
        </p>
        <pre className="demo-commands">
          <code>
            {'pnpm install --frozen-lockfile\ndocker compose up --build -d\npnpm demo:seed\npnpm demo'}
          </code>
        </pre>
        <div className="mkt-actions">
          <a className="mkt-text-link" href={`${repository}#run-the-complete-demo`}>
            Read the setup guide ↗
          </a>
          <Link className="mkt-text-link" href="/login">
            Sign in to your running workspace →
          </Link>
        </div>
      </section>
      <section className="dev-entry">
        <p className="mono-label">03 / Reference</p>
        <h2>Choose your next path.</h2>
        <div className="dev-paths">
          <a href="/v1/openapi.json">
            <strong>OpenAPI schema ↗</strong>
            <span>Raw JSON served by the running payments API.</span>
          </a>
          <Link href="/product#x402">
            <strong>Paid endpoints →</strong>
            <span>Price an HTTP request in test USDC on Base Sepolia.</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
