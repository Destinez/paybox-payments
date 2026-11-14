'use client';
import { useState } from 'react';
import { api, date, money, useResource } from '../lib/api';
import type { User } from '../lib/types';
import { Badge, Empty, ErrorNotice, Modal } from './ui';

type Route = {
  id: string;
  merchant_id: string;
  merchant_slug: string;
  method: string;
  path: string;
  upstream_url: string;
  price: string;
  pay_to: string;
  description: string;
  active: boolean;
  gateway_path: string;
};
type Payment = {
  id: string;
  payer: string;
  route: string;
  amount: string;
  transaction: string | null;
  status: string;
  created_at: string;
  last_error: string | null;
};
const usdc = (amount: string) =>
  `${BigInt(amount) / 1000000n}.${String(BigInt(amount) % 1000000n).padStart(6, '0')} USDC`;
function baseUnits(value: string) {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error('Enter a price with up to six decimal places');
  const [whole = '0', fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (amount <= 0n || amount > 10000000000n)
    throw new Error('Price must be greater than zero and at most 10,000 USDC');
  return String(amount);
}
export function X402({ user }: { user: User | null }) {
  const routes = useResource<{ data: Route[] }>('/admin/x402/routes');
  const payments = useResource<{ data: Payment[]; books: { NGN: string; USDC: string }; mode: string }>(
    '/admin/x402/payments',
  );
  const [editing, setEditing] = useState<Route | 'new' | null>(null),
    [error, setError] = useState('');
  const refresh = () => {
    routes.refresh();
    payments.refresh();
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PAY PER REQUEST · BASE SEPOLIA</div>
          <h1>Paid endpoints</h1>
          <p>Price your API. Collect test USDC with every successful request.</p>
        </div>
        {user?.role === 'admin' && (
          <button className="button primary" type="button" onClick={() => setEditing('new')}>
            Add priced route
          </button>
        )}
      </div>
      <ErrorNotice message={error || routes.error || payments.error} />
      <div className="book-grid">
        <section className="stat-card">
          <span className="eyebrow">NGN BOOK · MERCHANT PAYABLE</span>
          <h2>{money(payments.data?.books.NGN ?? '0')}</h2>
          <p>Paystack card and bank payments</p>
        </section>
        <section className="stat-card">
          <span className="eyebrow">USDC BOOK · MERCHANT PAYABLE</span>
          <h2>{usdc(payments.data?.books.USDC ?? '0')}</h2>
          <p>
            Base Sepolia · {payments.data?.mode === 'fake' ? 'Offline facilitator' : 'Testnet facilitator'}
          </p>
        </section>
      </div>
      <p className="muted book-note">
        Separate currencies, separate books. Balances come from ledger entries. No conversion or combined
        total.
      </p>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Priced routes</h2>
            <p>Payment settles after your upstream returns a successful response.</p>
          </div>
          <span className="count-label">{routes.data?.data.length ?? 0} routes</span>
        </div>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the table on narrow screens. */}
        <section className="table-scroll" aria-label="Priced routes table" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">Price per request</th>
                <th scope="col">Status</th>
                <th scope="col">Manage</th>
              </tr>
            </thead>
            <tbody>
              {routes.data?.data.map((route) => (
                <tr key={route.id}>
                  <td>
                    <strong>{route.description}</strong>
                    <div className="muted mono">
                      {route.method} {route.gateway_path}
                    </div>
                  </td>
                  <td>{usdc(route.price)}</td>
                  <td>
                    <Badge status={route.active ? 'active' : 'inactive'} />
                  </td>
                  <td>
                    {user?.role === 'admin' ? (
                      <div className="row-actions">
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`Edit ${route.description}`}
                          onClick={() => setEditing(route)}
                        >
                          Edit
                        </button>
                        {route.active && (
                          <button
                            type="button"
                            className="text-button"
                            aria-label={`Deactivate ${route.description}`}
                            onClick={async () => {
                              try {
                                await api(`/admin/x402/routes/${route.id}`, { method: 'DELETE' });
                                refresh();
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    ) : (
                      'Read only'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {routes.data?.data.length === 0 && (
          <Empty
            title="Your first paid endpoint"
            description="Add a route and set its price in test USDC to start accepting payments."
          />
        )}
      </section>
      <section className="panel x402-payments">
        <div className="panel-title">
          <div>
            <h2>x402 payments</h2>
            <p>The most recent 100 requests, including failures and confirmed settlements.</p>
          </div>
        </div>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the table on narrow screens. */}
        <section className="table-scroll" aria-label="x402 payment history" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Payer / route</th>
                <th scope="col">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Transaction</th>
                <th scope="col">Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.data?.data.map((payment) => (
                <tr key={payment.id}>
                  <td>
                    <span title={payment.payer} className="mono">
                      {payment.payer.slice(0, 8)}…{payment.payer.slice(-6)}
                    </span>
                    <div className="muted">{payment.route}</div>
                  </td>
                  <td>{usdc(payment.amount)}</td>
                  <td>
                    <Badge status={payment.status} />
                    {payment.last_error && <div className="muted payment-error">{payment.last_error}</div>}
                  </td>
                  <td>
                    {payment.transaction ? (
                      payments.data?.mode === 'fake' ? (
                        <span title={payment.transaction} className="mono">
                          Simulated · {payment.transaction.slice(0, 10)}…
                        </span>
                      ) : (
                        <a
                          href={`https://sepolia.basescan.org/tx/${payment.transaction}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`View transaction ${payment.transaction} on Base Sepolia`}
                        >
                          {payment.transaction.slice(0, 10)}… ↗
                        </a>
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{date(payment.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {payments.data?.data.length === 0 && (
          <Empty
            title="Ready for the first request"
            description="Successful payments appear here with their payer, receipt and ledger balance."
          />
        )}
      </section>
      {editing && (
        <RouteForm
          route={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSuccess={refresh}
        />
      )}
    </>
  );
}
function RouteForm({
  route,
  onClose,
  onSuccess,
}: {
  route?: Route;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const merchants = useResource<{ data: { id: string; name: string }[] }>('/admin/merchants', 0);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [secret, setSecret] = useState('');
  return (
    <Modal title={route ? 'Edit priced route' : 'Add priced route'} onClose={onClose}>
      <ErrorNotice message={error || merchants.error} />
      {secret ? (
        <>
          <p>
            Save this signing secret in your upstream service. It is shown once and also signs your merchant
            webhooks.
          </p>
          <pre className="issued-key">{secret}</pre>
          <button type="button" className="button primary" onClick={onClose}>
            Done
          </button>
        </>
      ) : (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const data = new FormData(e.currentTarget);
            try {
              const result = await api<{ signing_secret?: string }>(
                `/admin/x402/routes${route ? `/${route.id}` : ''}`,
                {
                  method: route ? 'PUT' : 'POST',
                  body: JSON.stringify({
                    ...(!route ? { merchant_id: data.get('merchant') } : {}),
                    method: data.get('method'),
                    path: data.get('path'),
                    upstream_url: data.get('upstream'),
                    price: baseUnits(String(data.get('price'))),
                    pay_to: data.get('pay_to'),
                    description: data.get('description'),
                    active: data.get('active') === 'on',
                  }),
                },
              );
              onSuccess();
              if (result.signing_secret) setSecret(result.signing_secret);
              else onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {!route && (
            <>
              <label htmlFor="route-merchant">Merchant</label>
              <select id="route-merchant" name="merchant" required>
                {merchants.data?.data.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <label htmlFor="route-description">Description</label>
          <input
            id="route-description"
            name="description"
            maxLength={160}
            defaultValue={route?.description}
            required
          />
          <label htmlFor="route-method">HTTP method</label>
          <select id="route-method" name="method" defaultValue={route?.method ?? 'GET'}>
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
          <label htmlFor="route-path">Endpoint path</label>
          <input id="route-path" name="path" placeholder="/v1/stock" defaultValue={route?.path} required />
          <label htmlFor="route-upstream">Upstream URL</label>
          <input
            id="route-upstream"
            name="upstream"
            type="url"
            placeholder="https://api.example.com/stock"
            defaultValue={route?.upstream_url}
            required
          />
          <label htmlFor="route-price">Price (USDC)</label>
          <input
            id="route-price"
            name="price"
            inputMode="decimal"
            placeholder="0.01"
            defaultValue={route ? usdc(route.price).split(' ')[0] : undefined}
            required
          />
          <label htmlFor="route-pay-to">Recipient address on Base Sepolia</label>
          <input
            id="route-pay-to"
            name="pay_to"
            placeholder="0x…"
            pattern="0x[0-9a-fA-F]{40}"
            defaultValue={route?.pay_to}
            required
          />
          <label className="checkbox-label" htmlFor="route-active">
            <input id="route-active" name="active" type="checkbox" defaultChecked={route?.active ?? true} />{' '}
            Route is active
          </label>
          <div className="modal-actions">
            <button className="button secondary" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save priced route'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
