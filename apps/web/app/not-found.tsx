import { ArrowRight, Route } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingShell } from '../components/marketing/shell';
import './(marketing)/marketing.css';

export const metadata: Metadata = {
  title: 'Page not found',
  description:
    'This Paybox page could not be found. Return to the public website, product walkthrough or operations sign-in.',
};

export default function NotFound() {
  return (
    <MarketingShell>
      <div className="mkt-container mkt-not-found">
        <div className="mkt-not-found-symbol" aria-hidden="true">
          <Route size={40} />
        </div>
        <p className="mkt-label">404 · A missing reference</p>
        <h1>This page is off the trail.</h1>
        <p>The address may have changed, or the page may not exist. There is still a clear way back.</p>
        <div className="mkt-actions">
          <Link className="mkt-button" href="/">
            Back to Paybox <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link className="mkt-button mkt-button-secondary" href="/product">
            Explore the product
          </Link>
        </div>
        <Link className="mkt-text-link" href="/login">
          Looking for operations? Sign in <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </MarketingShell>
  );
}
