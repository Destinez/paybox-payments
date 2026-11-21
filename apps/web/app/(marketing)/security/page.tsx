import type { Metadata } from 'next';
import Link from 'next/link';
import { contactEmail, DemoNote, PageIntro, repository } from '../../../components/marketing/shared';

export const metadata: Metadata = {
  title: 'Security and safety boundaries',
  description:
    'How Paybox verifies before credit, protects idempotency, checks signatures and keeps card data at Paystack. Test mode and Base Sepolia only.',
};

const sections = [
  {
    id: 'cards',
    title: 'No card data in Paybox',
    paragraphs: [
      'In Paystack test mode, checkout is hosted by Paystack. The local fake checkout collects no card details. Never submit card numbers, CVVs or banking credentials to a Paybox API or contact form.',
    ],
  },
  {
    id: 'verify',
    title: 'Verify before credit',
    paragraphs: [
      'A signed success event triggers processor verification. The reference, amount and currency must match the local payment before its status and balanced ledger entry commit together.',
    ],
  },
  {
    id: 'idempotency',
    title: 'Repeat the request, not the movement',
    paragraphs: [
      'Idempotency keys are scoped to a merchant and matched to the method, path and request body. The same request replays its result; a different body gets a conflict. Database claims protect concurrent submissions.',
    ],
  },
  {
    id: 'signatures',
    title: 'Verify the bytes you received',
    paragraphs: [
      'Webhook signatures are checked over the raw payload with constant-time comparisons. Timestamped signatures have a five-minute tolerance and support secret rotation. Outbound events are signed too.',
    ],
  },
  {
    id: 'access',
    title: 'Limit access to the workspace',
    paragraphs: [
      'Merchant API keys are hashed and scoped. Operations sessions use HttpOnly, SameSite cookies and CSRF checks, with admin, ops and viewer permissions. HTTPS deployments use Secure cookies.',
    ],
  },
  {
    id: 'boundaries',
    title: 'Test mode is part of the contract',
    paragraphs: [
      'Processes refuse Paystack live keys. The payment provider is a local fake or Paystack test mode. x402 accepts only Base Sepolia and its test-USDC contract; mainnet configuration is rejected.',
      'Deferred database checks require balanced journals across distinct accounts. Existing journals and lines cannot be rewritten. NGN and USDC use integer units and separate books.',
      'Confirmed x402 receipts can recover through the outbox. An external settlement timeout can leave an ambiguous result: the nonce stays consumed and the row needs investigation. It is never blindly credited or settled again.',
      'This portfolio project does not claim a PCI certification, a compliance accreditation or an uptime SLA. The implementation, tests and decision records are available in the repository.',
    ],
  },
];

export default function Security() {
  return (
    <div className="mkt-container">
      <PageIntro label="Security by construction" title="Trust starts with the checks.">
        The important boundaries live in the payment path, the database and the access controls. Here is what
        the demo enforces.
      </PageIntro>
      <DemoNote />
      <ul className="trust-points" aria-label="Key safeguards">
        <li>
          <strong>No card data</strong>
          <span>Paystack hosts test checkout.</span>
        </li>
        <li>
          <strong>Verify before credit</strong>
          <span>Reference, amount and currency must match.</span>
        </li>
        <li>
          <strong>Test rails only</strong>
          <span>No live keys or mainnet payments.</span>
        </li>
      </ul>
      <div className="doc-layout">
        <aside className="doc-rail">
          <details className="guide-index">
            <summary>Browse security checks</summary>
            <nav aria-label="On this page">
              <p className="mono-label">On this page</p>
              <ol>
                {sections.map((section, index) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      {section.title}
                    </a>
                  </li>
                ))}
                <li>
                  <a href="#report">
                    <span>07</span>
                    Report a concern
                  </a>
                </li>
              </ol>
            </nav>
          </details>
        </aside>
        <article className="doc-copy">
          {sections.map((section, index) => (
            <section id={section.id} key={section.id}>
              <h2>
                <span className="doc-num">{String(index + 1).padStart(2, '0')}</span>
                {section.title}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.id === 'boundaries' ? (
                <a className="mkt-text-link" href={`${repository}/tree/main/docs/adr`}>
                  Read the decision records →
                </a>
              ) : null}
            </section>
          ))}
          <section id="report">
            <h2>
              <span className="doc-num">07</span>
              Found something that needs attention?
            </h2>
            <p>
              Email the maintainer with a minimal reproduction. Keep credentials and customer data out of the
              report.
            </p>
            <a className="mkt-button" href={`mailto:${contactEmail}?subject=Paybox%20security%20report`}>
              Report a concern →
            </a>
            <p>
              <Link className="mkt-text-link" href="/privacy">
                How the demo handles data →
              </Link>
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
