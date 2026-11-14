'use client';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  CheckCheck,
  CircleHelp,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings2,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, date, money, useResource } from '../lib/api';
import type { Summary, User } from '../lib/types';
import { DeadLetters, Reconciliation } from './operations';
import { PaymentDetail } from './payment-detail';
import { PaymentForm } from './payment-form';
import { PaymentsList } from './payments-list';
import { Settings } from './settings';
import { ErrorNotice } from './ui';
export type Page = 'overview' | 'payments' | 'detail' | 'dead-letters' | 'reconciliation' | 'settings';
const titles: Record<Page, string> = {
  overview: 'Overview',
  payments: 'Payments',
  detail: 'Payment details',
  'dead-letters': 'Dead-letter queue',
  reconciliation: 'Reconciliation',
  settings: 'Access & settings',
};
export function Dashboard({ page = 'overview', paymentId }: { page?: Page; paymentId?: string }) {
  const session = useResource<{ user: User; csrf_token: string; mode: string }>('/session', 0);
  const summary = useResource<Summary>('/admin/summary');
  const [create, setCreate] = useState(false),
    [mobile, setMobile] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (session.data) sessionStorage.setItem('paybox_csrf', session.data.csrf_token);
  }, [session.data]);
  const user = session.data?.user ?? null;
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className={`sidebar ${mobile ? 'is-open' : ''}`} aria-label="Workspace navigation">
        <div className="sidebar-brand">
          <Link href="/" className="brand">
            <span className="brand-mark" />
            paybox<span className="brand-dot">.</span>
          </Link>
          <button
            className="mobile-close icon-button"
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace">
          <span className="workspace-icon">P</span>
          <div>
            <strong>Paybox Payments</strong>
            <small>Operations workspace</small>
          </div>
          <span className="workspace-chevron">⌄</span>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {[
            { id: 'overview', href: '/', label: 'Overview', icon: LayoutDashboard },
            { id: 'payments', href: '/payments', label: 'Payments', icon: ArrowDownLeft },
            { id: 'dead-letters', href: '/dead-letters', label: 'Dead-letter queue', icon: Wallet },
            { id: 'reconciliation', href: '/reconciliation', label: 'Reconciliation', icon: CheckCheck },
          ].map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={page === item.id || (page === 'detail' && item.id === 'payments') ? 'active' : ''}
            >
              <item.icon size={18} />
              {item.label}
              {item.id === 'dead-letters' && !!summary.data?.dlq_depth && (
                <span className="nav-count">{summary.data.dlq_depth}</span>
              )}
            </Link>
          ))}
          {user?.role === 'admin' && (
            <Link href="/settings" className={page === 'settings' ? 'active' : ''}>
              <Settings2 size={18} />
              Access & settings
            </Link>
          )}
        </nav>
        <div className="sidebar-bottom">
          <a className="sidebar-docs" href="http://localhost:4000/docs" target="_blank" rel="noreferrer">
            <BookOpen size={17} />
            API documentation
            <ExternalLink size={12} />
          </a>
          <div className="environment-card">
            <span className="status-dot" />
            <div>
              <strong>Test environment</strong>
              <small>
                {session.data?.mode === 'fake' ? 'Local payment processor' : 'Paystack test mode'}
              </small>
            </div>
            <ShieldCheck size={18} />
          </div>
          <div className="profile">
            <span className="avatar">{user?.email[0]?.toUpperCase() ?? 'O'}</span>
            <div>
              <strong>{user?.email.split('@')[0] ?? 'Operations'}</strong>
              <small>{user?.role === 'ops' ? 'Operator' : (user?.role ?? 'Signing in…')}</small>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await api('/session/logout', { method: 'POST' });
                  sessionStorage.removeItem('paybox_csrf');
                  window.location.assign('/login');
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          type="button"
          className="nav-scrim"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              type="button"
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb-root">Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <span>{titles[page]}</span>
          </div>
          <div className="topbar-right">
            <span className="test-tag">
              <span />
              TEST MODE
            </span>
            <span className="topbar-divider" />
            <a
              href="http://localhost:4000/docs"
              aria-label="Open API documentation"
              target="_blank"
              rel="noreferrer"
            >
              <CircleHelp size={18} />
            </a>
            <span className="avatar small">OD</span>
          </div>
        </header>
        <main id="main">
          <ErrorNotice message={error || session.error} />
          {(page === 'overview' || page === 'payments') && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">PAYMENT OPERATIONS</span>
                  <h1>{page === 'overview' ? 'Every payment. Accounted for.' : 'Payments'}</h1>
                  <p>
                    {page === 'overview'
                      ? 'Your money movement, with nothing lost in between.'
                      : 'A complete view of every payment across your merchants.'}
                  </p>
                </div>
                {user?.role !== 'viewer' && (
                  <button className="button primary" type="button" onClick={() => setCreate(true)}>
                    <Plus size={16} />
                    Create payment
                  </button>
                )}
              </div>
              <ErrorNotice message={summary.error} />
              <Stats summary={summary.data} />
              {page === 'overview' && <Overview summary={summary.data} />}
              <PaymentsList compact={page === 'overview'} />
            </>
          )}
          {page === 'detail' && paymentId && <PaymentDetail id={paymentId} user={user} />}{' '}
          {page === 'dead-letters' && <DeadLetters user={user} />}{' '}
          {page === 'reconciliation' && <Reconciliation user={user} />}{' '}
          {page === 'settings' && <Settings user={user} />}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} />
              Paystack test mode. No real money moves.
            </span>
            <span>
              Built with care in Lagos <span className="footer-dot">·</span> NGN
            </span>
          </footer>
        </main>
      </div>
      {create && <PaymentForm onClose={() => setCreate(false)} />}
    </div>
  );
}
function Stats({ summary }: { summary: Summary | null }) {
  return (
    <div className="stats-grid">
      <section className="stat-card">
        <div className="stat-label">
          Volume today
          <ArrowUpRight size={16} />
        </div>
        <strong>{summary ? money(summary.volume_today) : '—'}</strong>
        <p>
          <span className="stat-dot" />
          Verified payments · NGN
        </p>
      </section>
      <section className="stat-card">
        <div className="stat-label">
          Success rate
          <ChartNoAxesCombined size={16} />
        </div>
        <strong>{summary ? `${summary.success_rate.toFixed(1)}%` : '—'}</strong>
        <p>{summary ? `${summary.successful} of ${summary.total} payments` : 'Loading payment activity'}</p>
      </section>
      <section className="stat-card">
        <div className="stat-label">
          Dead-letter queue
          <Wallet size={16} />
        </div>
        <strong>
          {summary?.dlq_depth ?? '—'}
          <span className={`stat-chip ${summary?.dlq_depth ? 'warning' : ''}`}>
            {summary?.dlq_depth ? 'Needs attention' : 'All clear'}
          </span>
        </strong>
        <p>{summary?.dlq_depth ? 'Deliveries waiting for review' : 'No failed deliveries to review'}</p>
      </section>
      <section className="stat-card">
        <div className="stat-label">
          Last reconciliation
          <CheckCheck size={16} />
        </div>
        <strong className="stat-text">
          {!summary?.last_reconciliation
            ? 'Not run'
            : summary.last_reconciliation.status !== 'completed'
              ? 'Running'
              : summary.last_reconciliation.mismatched
                ? 'Review needed'
                : 'Reconciled'}
          <span className={`recon-indicator ${summary?.last_reconciliation?.mismatched ? 'warning' : ''}`} />
        </strong>
        <p>
          {summary?.last_reconciliation
            ? `${summary.last_reconciliation.checked} payments checked · ${date(summary.last_reconciliation.createdAt)}`
            : 'Run a check to compare your ledger'}
        </p>
      </section>
    </div>
  );
}
function Overview({ summary }: { summary: Summary | null }) {
  const values = summary?.series ?? [],
    maximum = Math.max(1, ...values.map((v) => Number(v.volume)));
  const total = values.reduce((sum, v) => sum + BigInt(v.volume), 0n);
  return (
    <div className="overview-grid">
      <section className="panel volume-panel">
        <div className="panel-title">
          <div>
            <h2>Payment volume</h2>
            <p>Successfully verified payments</p>
          </div>
          <span className="period-label">Last 14 days</span>
        </div>
        <div className="chart-total">
          {money(total.toString())}
          <span>NGN</span>
        </div>
        <div className="bar-chart" role="img" aria-label="Daily payment volume over the last fourteen days">
          {values.map((value) => (
            <div key={value.day} className="bar-column" title={`${value.day}: ${money(value.volume)}`}>
              <div
                className="bar"
                style={{ height: `${Math.max(2, (Number(value.volume) / maximum) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="chart-labels">
          <span>{values[0] ? date(`${values[0].day}T12:00:00Z`) : '14 days ago'}</span>
          <span>Today</span>
        </div>
      </section>
      <section className="health-panel">
        <div className="health-icon">
          <CheckCheck size={22} />
        </div>
        <span className="eyebrow">BUILT TO BALANCE</span>
        <h2>
          A clear trail.
          <br />
          Every single time.
        </h2>
        <p>
          Verified payments, balanced entries, and durable delivery. The details are always there when you
          need them.
        </p>
        <div className="health-row">
          <span>Payment verification</span>
          <span>
            <span className="status-dot" />
            Active
          </span>
        </div>
        <div className="health-row">
          <span>Double-entry ledger</span>
          <span>
            <span className="status-dot" />
            Enforced
          </span>
        </div>
        <Link href="/reconciliation">
          Review reconciliation
          <ArrowRight size={15} />
        </Link>
      </section>
    </div>
  );
}
