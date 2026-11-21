import type { Metadata } from 'next';
import { PageIntro, repository } from '../../../components/marketing/shared';

export const metadata: Metadata = {
  title: 'Repository history',
  description:
    'Paybox does not publish numbered releases. The repository history and the accepted x402 decision record are the changelog.',
};

export default function Changelog() {
  return (
    <div className="mkt-container">
      <PageIntro label="Repository history" title="The repository is the record.">
        Paybox does not publish numbered commercial releases or a support schedule. What you can inspect is
        the source.
      </PageIntro>
      <article className="changelog-note">
        <section>
          <h2>What the repository contains</h2>
          <p>
            Idempotent checkout, verify-before-credit, signed webhook dedupe, outbox retries, dead-letter
            replay, an immutable double-entry ledger, reconciliation, partial refunds and x402 paid endpoints.
            The local walkthrough is <code>pnpm demo</code>.
          </p>
        </section>
        <section>
          <h2>14 November 2026 · x402 gateway decision</h2>
          <p>
            The x402 gateway decision was accepted on 14 November 2026. That date is the status line in{' '}
            <code>docs/adr/x402-gateway.md</code>, not a product version.
          </p>
          <a className="mkt-text-link" href={`${repository}/blob/main/docs/adr/x402-gateway.md`}>
            Read the decision →
          </a>
        </section>
        <section>
          <h2>History</h2>
          <p>Commit history is the changelog. There is no separate release feed.</p>
          <a className="mkt-text-link" href={`${repository}/commits/main`}>
            Explore the commit history →
          </a>
        </section>
      </article>
    </div>
  );
}
