'use client';
import { ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { api, kobo, money, useResource } from '../lib/api';
import type { PaymentDetail } from '../lib/types';
import { ErrorNotice, Modal } from './ui';
export function PaymentForm({ onClose }: { onClose: () => void }) {
  const merchants = useResource<{ data: { id: string; name: string }[] }>('/admin/merchants', 0);
  const [key] = useState(() => crypto.randomUUID()),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Create a payment" onClose={onClose}>
      <p className="muted">Create a checkout link for a customer. Amounts are in Nigerian naira.</p>
      <ErrorNotice message={error || merchants.error} />
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setBusy(true);
          try {
            const payment = await api<{ id: string }>('/admin/payments', {
              method: 'POST',
              headers: { 'Idempotency-Key': key },
              body: JSON.stringify({
                merchant_id: data.get('merchant'),
                amount: kobo(String(data.get('amount'))),
                currency: 'NGN',
                customer: { email: data.get('email') },
                metadata: { description: data.get('description') },
              }),
            });
            window.location.assign(`/payments/${payment.id}`);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="merchant">Merchant</label>
        <select id="merchant" name="merchant" required>
          {merchants.data?.data.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <label htmlFor="customer-email">Customer email</label>
        <input id="customer-email" name="email" type="email" placeholder="ada@example.com" required />
        <label htmlFor="amount">Amount (NGN)</label>
        <div className="amount-input">
          <span>₦</span>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            placeholder="15,000.00"
            required
            pattern="[0-9]+([.][0-9]{1,2})?"
          />
        </div>
        <label htmlFor="description">
          Description <span className="muted">optional</span>
        </label>
        <input
          id="description"
          name="description"
          maxLength={160}
          placeholder="Order or invoice description"
        />
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy || !merchants.data?.data.length}>
            {busy ? 'Creating…' : 'Create payment'}
            <ArrowUpRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function RefundForm({
  payment,
  onClose,
  onSuccess,
}: {
  payment: PaymentDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const remaining =
    payment.amount -
    payment.refunds.filter((r) => r.status !== 'failed').reduce((sum, r) => sum + r.amount, 0);
  const [key] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title="Issue a refund" onClose={onClose}>
      <p className="muted">
        Up to <strong>{money(remaining)}</strong> is refundable. Leave the amount blank to refund the
        remaining balance.
      </p>
      <ErrorNotice message={error} />
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setBusy(true);
          try {
            await api(`/admin/payments/${payment.id}/refunds`, {
              method: 'POST',
              headers: { 'Idempotency-Key': key },
              body: JSON.stringify({
                ...(data.get('amount') ? { amount: kobo(String(data.get('amount'))) } : {}),
                reason: data.get('reason'),
              }),
            });
            onSuccess();
            onClose();
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="refund-amount">Refund amount (NGN)</label>
        <input id="refund-amount" name="amount" inputMode="decimal" placeholder="Full remaining amount" />
        <label htmlFor="refund-reason">Reason</label>
        <textarea
          id="refund-reason"
          name="reason"
          maxLength={160}
          placeholder="Tell us why this payment is being refunded"
          required
        />
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? 'Requesting…' : 'Request refund'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
