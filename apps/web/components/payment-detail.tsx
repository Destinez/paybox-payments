'use client';
import { ArrowLeft, ArrowUpRight, CheckCheck, Copy, RefreshCw, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api, date, human, money, time, useResource } from '../lib/api';
import type { PaymentDetail as Detail, User } from '../lib/types';
import { RefundForm } from './payment-form';
import { Badge, Empty, ErrorNotice } from './ui';
export function PaymentDetail({ id, user }: { id: string; user: User | null }) {
  const { data, error, refresh } = useResource<Detail>(`/admin/payments/${id}`, 2000);
  const [refund, setRefund] = useState(false),
    [actionError, setActionError] = useState(''),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState(''),
    [correlation, setCorrelation] = useState(''),
    [copied, setCopied] = useState(false);
  if (!data)
    return (
      <>
        <ErrorNotice message={error} />
        <div className="loading" role="status">
          Loading payment details…
        </div>
      </>
    );
  const events = data.timeline.filter(
    (event) =>
      (!source || event.source === source) && (!correlation || event.correlation_id?.includes(correlation)),
  );
  const debit = data.ledger_entries
      .filter((l) => l.direction === 'debit')
      .reduce((sum, l) => sum + BigInt(l.amount), 0n),
    credit = data.ledger_entries
      .filter((l) => l.direction === 'credit')
      .reduce((sum, l) => sum + BigInt(l.amount), 0n);
  const canRefund = user?.role !== 'viewer' && ['succeeded', 'partially_refunded'].includes(data.status);
  return (
    <>
      <Link href="/payments" className="back-link">
        <ArrowLeft size={14} />
        All payments
      </Link>
      <div className="page-heading detail-heading">
        <div>
          <span className="eyebrow">PAYMENT DETAILS</span>
          <h1 className="payment-reference">
            {data.reference}
            <button
              type="button"
              className="icon-button"
              aria-label="Copy payment reference"
              onClick={() => {
                void navigator.clipboard.writeText(data.reference);
                setCopied(true);
              }}
            >
              {copied ? <CheckCheck size={17} /> : <Copy size={17} />}
            </button>
          </h1>
          <p>
            Created {date(data.created_at)} at {time(data.created_at)} · Lagos time
          </p>
        </div>
        <div className="heading-actions">
          {user?.role !== 'viewer' && (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setActionError('');
                try {
                  await api(`/admin/payments/${id}/verify`, { method: 'POST' });
                  refresh();
                } catch (error) {
                  setActionError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw size={15} className={busy ? 'spin' : ''} />
              {busy ? 'Verifying…' : 'Verify payment'}
            </button>
          )}
          {canRefund && (
            <button type="button" className="button primary" onClick={() => setRefund(true)}>
              <RotateCcw size={15} />
              Issue refund
            </button>
          )}
        </div>
      </div>
      <ErrorNotice message={error || actionError} />
      <div className="payment-summary panel">
        <div>
          <span className="eyebrow">PAYMENT AMOUNT</span>
          <div className="detail-amount">{money(data.amount)}</div>
          <Badge status={data.status} />
        </div>
        <dl>
          <div>
            <dt>Customer</dt>
            <dd>{data.customer.email}</dd>
          </div>
          <div>
            <dt>Payment channel</dt>
            <dd>{human(data.channel ?? 'Awaiting checkout')}</dd>
          </div>
          <div>
            <dt>Processor fee</dt>
            <dd>{data.fees === null ? '—' : money(data.fees)}</dd>
          </div>
          <div>
            <dt>Refunded</dt>
            <dd>{money(data.refunded_amount)}</dd>
          </div>
        </dl>
        {data.status === 'pending' && data.authorization_url && (
          <a
            className="button primary checkout-link"
            href={data.authorization_url}
            target="_blank"
            rel="noreferrer"
          >
            Open test checkout
            <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      <div className="detail-grid">
        <section className="panel timeline-panel">
          <div className="panel-title">
            <div>
              <h2>Payment timeline</h2>
              <p>The complete trail, in the order it happened.</p>
            </div>
            <span className="count-pill">{data.timeline.length} events</span>
          </div>
          <div className="timeline-controls">
            <select
              aria-label="Filter timeline source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">All sources</option>
              <option value="webhook">Webhooks</option>
              <option value="worker">Worker & retries</option>
              <option value="ledger">Ledger</option>
              <option value="api">API</option>
              <option value="recon">Reconciliation</option>
            </select>
            <input
              aria-label="Filter by correlation ID"
              placeholder="Filter by correlation ID"
              value={correlation}
              onChange={(e) => setCorrelation(e.target.value)}
            />
          </div>
          <ol className="timeline">
            {events.map((event) => (
              <li key={`${event.source}-${event.id}`}>
                <span className={`timeline-dot ${event.source}`} />
                <div className="event-head">
                  <strong>{human(event.type)}</strong>
                  <time dateTime={event.created_at}>{time(event.created_at)}</time>
                </div>
                <div className="event-meta">
                  <span>{event.source}</span>
                  {event.detail.outcome !== undefined && <Badge status={String(event.detail.outcome)} />}{' '}
                  {event.detail.attempt !== undefined && <span>Attempt {String(event.detail.attempt)}</span>}
                  {event.detail.amount !== undefined && <span>{money(String(event.detail.amount))}</span>}
                  {event.detail.direction !== undefined && <span>{String(event.detail.direction)}</span>}
                </div>
                {event.detail.error ? <p className="event-error">{String(event.detail.error)}</p> : null}
                {event.detail.account ? (
                  <p className="event-account">
                    {String(event.detail.account).split(':')[0]?.replaceAll('_', ' ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          {!events.length && (
            <Empty
              title="No matching events"
              description="Adjust the timeline filters to see more activity."
            />
          )}
        </section>
        <div className="detail-aside">
          <section className="panel">
            <div className="panel-title">
              <div>
                <h2>Ledger</h2>
                <p>Double-entry accounting</p>
              </div>
              <CheckCheck size={19} className="green" />
            </div>
            <div className="ledger-totals">
              <div>
                <span>Total debits</span>
                <strong>{money(debit.toString())}</strong>
              </div>
              <div>
                <span>Total credits</span>
                <strong>{money(credit.toString())}</strong>
              </div>
              <div className="ledger-balanced">
                <span>Difference</span>
                <strong>{money((debit - credit).toString())}</strong>
              </div>
            </div>
            <div className="ledger-entries">
              {data.ledger_entries
                .filter((l) => l.direction === 'debit')
                .map((line) => (
                  <div key={line.id}>
                    <span>{human(line.kind)}</span>
                    <strong>{money(line.amount)}</strong>
                  </div>
                ))}
            </div>
            <p className="panel-footnote">Balances are derived from immutable entries.</p>
          </section>
          <section className="panel">
            <div className="panel-title">
              <div>
                <h2>Refunds</h2>
                <p>{data.refunds.length} refund requests</p>
              </div>
            </div>
            {data.refunds.length ? (
              <div className="refund-list">
                {data.refunds.map((row) => (
                  <div key={row.id}>
                    <div>
                      <strong>{money(row.amount)}</strong>
                      <Badge status={row.status} />
                    </div>
                    <p>{row.reason}</p>
                    <small>{row.reference}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="panel-footnote">No refunds have been requested.</p>
            )}
          </section>
          <section className="trace-card">
            <span className="eyebrow">CORRELATION ID</span>
            <code>{data.correlation_id}</code>
            <p>Links this payment to its events and deliveries.</p>
          </section>
        </div>
      </div>
      {refund && <RefundForm payment={data} onClose={() => setRefund(false)} onSuccess={refresh} />}
    </>
  );
}
