'use client';
import { ArrowDownLeft, ArrowRight, ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { date, human, money, useResource } from '../lib/api';
import type { Payment } from '../lib/types';
import { Badge, Empty, ErrorNotice } from './ui';
export function PaymentsList({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState(''),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [cursor, setCursor] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setCursor('');
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({ limit: compact ? '6' : '15' });
  if (status) params.set('status', status);
  if (query) params.set('q', query);
  if (from) params.set('from', new Date(`${from}T00:00:00+01:00`).toISOString());
  if (to) params.set('to', new Date(`${to}T23:59:59.999+01:00`).toISOString());
  if (cursor) params.set('page_token', cursor);
  const { data, error } = useResource<{ data: Payment[]; next_page_token: string | null }>(
    `/admin/payments?${params}`,
  );
  return (
    <section className="panel payments-panel">
      <div className="panel-title">
        <div>
          <h2>{compact ? 'Recent payments' : 'All payments'}</h2>
          <p>
            {compact
              ? 'The latest activity across your merchants.'
              : 'Track every transaction from checkout to settlement.'}
          </p>
        </div>
        {compact ? (
          <Link href="/payments" className="text-link">
            View all payments
            <ArrowRight size={15} />
          </Link>
        ) : (
          <span className="subtle-label">NGN · Lagos time</span>
        )}
      </div>
      {!compact && (
        <>
          <fieldset className="tabs" aria-label="Payment status filters">
            {[
              ['', 'All payments'],
              ['succeeded', 'Succeeded'],
              ['pending', 'Pending'],
              ['failed', 'Failed'],
              ['partially_refunded', 'Partially refunded'],
              ['refunded', 'Refunded'],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={status === value ? 'active' : ''}
                onClick={() => {
                  setStatus(value!);
                  setCursor('');
                }}
                aria-pressed={status === value}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <div className="filters">
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Search payments"
                placeholder="Search by reference or email…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="date-filters">
              <SlidersHorizontal size={15} />
              <label>
                From
                <input
                  type="date"
                  aria-label="From date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setCursor('');
                  }}
                />
              </label>
              <span>—</span>
              <label>
                To
                <input
                  type="date"
                  aria-label="To date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setCursor('');
                  }}
                />
              </label>
            </div>
          </div>
        </>
      )}
      <ErrorNotice message={error} />
      {!data && !error ? (
        <div className="loading" role="status">
          Loading payments…
        </div>
      ) : data?.data.length ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Payment / customer</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Channel</th>
                  <th>
                    Date
                    <ChevronDown size={12} />
                  </th>
                  <th>
                    <span className="sr-only">Open payment</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((payment) => (
                  <tr key={payment.id}>
                    <td>
                      <div className="payment-cell">
                        <span className="transaction-icon">
                          <ArrowDownLeft size={17} />
                        </span>
                        <div>
                          <Link className="reference-link" href={`/payments/${payment.id}`}>
                            {payment.reference}
                          </Link>
                          <span className="cell-secondary">{payment.customer.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge status={payment.status} />
                    </td>
                    <td className="money">
                      {money(payment.amount)}
                      <span className="cell-secondary currency">{payment.currency}</span>
                    </td>
                    <td className="channel">{human(payment.channel ?? 'checkout')}</td>
                    <td className="date-cell">{date(payment.created_at)}</td>
                    <td>
                      <Link
                        href={`/payments/${payment.id}`}
                        className="table-arrow"
                        aria-label={`Open ${payment.reference}`}
                      >
                        <ArrowRight size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!compact && (
            <div className="pagination">
              <span>{data.data.length} payments on this page</span>
              <div>
                {cursor && (
                  <button type="button" className="button small secondary" onClick={() => setCursor('')}>
                    First page
                  </button>
                )}
                <button
                  type="button"
                  className="button small secondary"
                  disabled={!data.next_page_token}
                  onClick={() => setCursor(data.next_page_token!)}
                >
                  Next page
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <Empty
          title="No payments found"
          description="Create a payment or adjust your filters to see activity here."
        />
      )}
    </section>
  );
}
