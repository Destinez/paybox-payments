'use client';

import { ArrowRight, Check, RotateCcw } from 'lucide-react';
import { useState } from 'react';

const phases = [
  {
    label: 'Verify',
    status: 'Queued',
    attempts: 0,
    note: 'The charge is verified. Its merchant notification is ready to send.',
    next: 'Show delivery failure',
  },
  {
    label: 'Fail',
    status: 'Delivery failed',
    attempts: 8,
    note: 'The merchant endpoint was unavailable. Eight attempts failed; the payment is still verified.',
    next: 'Replay notification',
  },
  {
    label: 'Replay',
    status: 'Replay queued',
    attempts: 8,
    note: 'The endpoint is back. An operator queues the same notification for replay, not a new charge.',
    next: 'See delivery result',
  },
  {
    label: 'Deliver',
    status: 'Delivered',
    attempts: 9,
    note: 'The merchant received the notification. The original charge and its journal stayed intact.',
    next: 'Restart example',
  },
] as const;

export function PaymentRecord() {
  const [index, setIndex] = useState(0);
  const phase = phases[index]!;
  const last = index === phases.length - 1;
  return (
    <article id="test-payment" tabIndex={-1} className="trace-record" aria-label="Interactive test payment">
      <header className="record-head">
        <span className="record-symbol" aria-hidden="true">
          P
        </span>
        <strong>Payment record</strong>
        <span>Interactive example</span>
      </header>
      <div className="record-core">
        <p className="record-ref">
          REF_TEST_15000 <span>NGN</span>
        </p>
        <div className="record-amount">
          ₦15,000<span>.00</span>
        </div>
        <div className="record-payment">
          <Check aria-hidden="true" size={15} /> Payment verified
        </div>
      </div>
      <div className="record-flow">
        <div className="record-index">
          <span>Delivery trace</span>
          <span>0{index + 1} / 04</span>
        </div>
        <fieldset className="phase-rail" aria-label="Choose a trace step">
          {phases.map(({ label }, i) => (
            <button
              key={label}
              type="button"
              aria-pressed={index === i}
              className={i <= index ? 'reached' : undefined}
              onClick={() => setIndex(i)}
            >
              <i aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </fieldset>
        <div aria-live="polite" aria-atomic="true">
          <div className="phase-copy" key={phase.label}>
            <div className="phase-title">
              <strong>{phase.status}</strong>
              <span>{phase.attempts} attempts</span>
            </div>
            <p>{phase.note}</p>
          </div>
        </div>
        <button className="advance-trace" type="button" onClick={() => setIndex(last ? 0 : index + 1)}>
          {phase.next}
          {last ? <RotateCcw size={15} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </div>
      <footer className="record-foot">
        Simulated timeline <span>No real money</span>
      </footer>
    </article>
  );
}
