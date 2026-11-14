'use client';
import { Check, Clock3, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { human } from '../lib/api';
export function Badge({ status }: { status: string }) {
  const good = [
      'settled',
      'active',
      'succeeded',
      'processed',
      'completed',
      'matched',
      'auto_healed',
      'resolved',
    ].includes(status),
    bad = ['settlement_failed', 'upstream_failed', 'failed', 'dead', 'open', 'mismatched'].includes(status);
  const Icon = good ? Check : bad ? TriangleAlert : Clock3;
  return (
    <span className={`badge ${good ? 'good' : bad ? 'bad' : 'neutral'}`}>
      <Icon size={12} />
      {human(status)}
    </span>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="notice error" role="alert">
      <TriangleAlert size={16} />
      {message}
    </div>
  ) : null;
}
export function Empty({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Check size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="modal" onCancel={onClose} aria-label={title}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
