'use client';
import { ArrowRight, CheckCheck, Play, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api, date, human, money, time, useResource } from '../lib/api';
import type { Finding, Job, Run, User } from '../lib/types';
import { Badge, Empty, ErrorNotice, Modal } from './ui';
export function DeadLetters({ user }: { user: User | null }) {
  const { data, error, refresh } = useResource<{ data: Job[] }>('/admin/dlq', 2000);
  const [busy, setBusy] = useState(''),
    [actionError, setActionError] = useState(''),
    [message, setMessage] = useState('');
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DELIVERY OPERATIONS</span>
          <h1>Dead-letter queue</h1>
          <p>Failed jobs, with the context to get them moving again.</p>
        </div>
        <span className="large-count">
          {data?.data.length ?? 0}
          <small>need attention</small>
        </span>
      </div>
      <ErrorNotice message={error || actionError} />
      {message && (
        <div className="notice success" role="status">
          <CheckCheck size={16} />
          {message}
        </div>
      )}
      <div className="notice info">
        Replay starts a new attempt budget. Previous attempts and the operator’s action remain in the audit
        trail.
      </div>
      {!data ? (
        <div className="loading">Loading queue…</div>
      ) : !data.data.length ? (
        <section className="panel">
          <Empty
            title="Nothing needs rescuing"
            description="There are no dead-letter jobs. Failed deliveries will appear here with their retry history."
          />
        </section>
      ) : (
        <div className="jobs-list">
          {data.data.map((job) => (
            <section className="panel job-card" key={job.id}>
              <div className="job-head">
                <div>
                  <div className="event-meta">
                    <Badge status="dead" />
                    <span>{job.totalAttempts} total attempts</span>
                  </div>
                  <h2>{human(job.type)}</h2>
                  <p>{job.lastError}</p>
                </div>
                {user?.role !== 'viewer' && (
                  <button
                    className="button primary"
                    type="button"
                    disabled={busy === job.id}
                    onClick={async () => {
                      setBusy(job.id);
                      setActionError('');
                      try {
                        await api(`/admin/dlq/${job.id}/replay`, { method: 'POST' });
                        setMessage('Job queued for replay. Its attempt history has been preserved.');
                        refresh();
                      } catch (error) {
                        setActionError((error as Error).message);
                      } finally {
                        setBusy('');
                      }
                    }}
                  >
                    <RotateCcw size={15} />
                    {busy === job.id ? 'Replaying…' : 'Replay'}
                  </button>
                )}
              </div>
              <div className="job-info">
                <span>
                  Created {date(job.createdAt)} at {time(job.createdAt)}
                </span>
                {job.payload.payment_id ? (
                  <Link href={`/payments/${job.payload.payment_id}`} className="text-link">
                    View payment
                    <ArrowRight size={14} />
                  </Link>
                ) : null}
              </div>
              <details>
                <summary>
                  View attempt history <span>{job.history.length} attempts</span>
                </summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Attempt</th>
                        <th>Started</th>
                        <th>Outcome</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {job.history.map((attempt) => (
                        <tr key={attempt.id}>
                          <td>#{attempt.attemptNo}</td>
                          <td>{time(attempt.startedAt)}</td>
                          <td>
                            <Badge status={attempt.outcome} />
                          </td>
                          <td>{attempt.error ?? 'Delivered'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
export function Reconciliation({ user }: { user: User | null }) {
  const runs = useResource<{ data: Run[] }>('/admin/reconciliation/runs', 2000);
  const [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(''),
    [finding, setFinding] = useState<Finding | null>(null);
  const id = selected || runs.data?.data[0]?.id;
  const report = useResource<Run>(id ? `/admin/reconciliation/runs/${id}` : null, 2000);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">FINANCIAL CONTROL</span>
          <h1>Reconciliation</h1>
          <p>What we recorded. What the processor knows. A clear comparison.</p>
        </div>
        {user?.role !== 'viewer' && (
          <button
            className="button primary"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setActionError('');
              try {
                const run = await api<{ id: string }>('/admin/reconciliation/runs', { method: 'POST' });
                setSelected(run.id);
                runs.refresh();
              } catch (error) {
                setActionError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Play size={14} />
            {busy ? 'Starting…' : 'Run reconciliation'}
          </button>
        )}
      </div>
      <ErrorNotice message={runs.error || report.error || actionError} />
      <div className="notice info">
        Runs nightly at 02:00 Lagos time. Missing successful webhooks are recovered; amount mismatches always
        require review.
      </div>
      {!runs.data?.data.length ? (
        <section className="panel">
          <Empty
            title="Ready for the first check"
            description="Run reconciliation to compare the last 48 hours and older pending payments with the processor."
          />
        </section>
      ) : (
        <div className="recon-layout">
          <aside className="panel run-list" aria-label="Reconciliation runs">
            <div className="panel-title">
              <h2>Recent runs</h2>
            </div>
            {runs.data.data.map((run) => (
              <button
                type="button"
                key={run.id}
                className={id === run.id ? 'selected' : ''}
                onClick={() => setSelected(run.id)}
              >
                <span>
                  {date(run.createdAt)}
                  <small>{time(run.createdAt)}</small>
                </span>
                <Badge
                  status={
                    run.status === 'completed' ? (run.mismatched ? 'mismatched' : 'matched') : run.status
                  }
                />
              </button>
            ))}
          </aside>
          <section className="panel report">
            <div className="panel-title">
              <div>
                <h2>Reconciliation report</h2>
                <p>{report.data ? date(report.data.createdAt) : 'Loading report…'}</p>
              </div>
              {report.data && <Badge status={report.data.status} />}
            </div>
            {report.data && (
              <>
                <div className="report-stats">
                  <div>
                    <span>Checked</span>
                    <strong>{report.data.checked}</strong>
                  </div>
                  <div>
                    <span>Matched / recovered</span>
                    <strong className="green">{report.data.matched}</strong>
                  </div>
                  <div>
                    <span>Mismatched</span>
                    <strong className={report.data.mismatched ? 'red' : ''}>{report.data.mismatched}</strong>
                  </div>
                </div>
                {report.data.status !== 'completed' && (
                  <div className="notice info" role="status">
                    Comparing transactions with the processor…
                  </div>
                )}
                {!report.data.items?.length && report.data.status === 'completed' ? (
                  <Empty
                    title="Everything lines up"
                    description="The checked payments agree with the processor and the ledger."
                  />
                ) : (
                  <div className="findings">
                    {report.data.items?.map((item) => (
                      <article className="finding" key={item.id}>
                        <div className="finding-head">
                          <h3>{human(item.kind)}</h3>
                          <Badge status={item.resolution} />
                        </div>
                        <p className="mono">
                          {String(item.local.reference ?? item.paymentId ?? 'Unknown reference')}
                        </p>
                        <div className="comparison">
                          <div>
                            <span>Paybox</span>
                            <strong>
                              {item.local.amount
                                ? money(String(item.local.amount))
                                : String(item.local.status ?? 'Not found')}
                            </strong>
                            <small>{String(item.local.status ?? '')}</small>
                          </div>
                          <ArrowRight size={16} />
                          <div>
                            <span>Processor</span>
                            <strong>
                              {item.remote.amount
                                ? money(String(item.remote.amount))
                                : String(item.remote.status ?? 'Unknown')}
                            </strong>
                            <small>{String(item.remote.status ?? '')}</small>
                          </div>
                        </div>
                        {item.note && <p className="resolution-note">{item.note}</p>}
                        <div className="finding-actions">
                          {item.paymentId && (
                            <Link href={`/payments/${item.paymentId}`} className="text-link">
                              View payment
                              <ArrowRight size={13} />
                            </Link>
                          )}
                          {item.resolution === 'open' && user?.role !== 'viewer' && (
                            <button
                              className="button small secondary"
                              type="button"
                              onClick={() => setFinding(item)}
                            >
                              Resolve finding
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
      {finding && <Resolve finding={finding} onClose={() => setFinding(null)} onSuccess={report.refresh} />}
    </>
  );
}
function Resolve({
  finding,
  onClose,
  onSuccess,
}: {
  finding: Finding;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Resolve finding" onClose={onClose}>
      <p className="muted">
        Record the evidence for closing this {human(finding.kind)}. This does not change the payment amount or
        ledger.
      </p>
      <ErrorNotice message={error} />
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await api(`/admin/reconciliation/items/${finding.id}/resolve`, {
              method: 'POST',
              body: JSON.stringify({ note: new FormData(event.currentTarget).get('note') }),
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
        <label htmlFor="resolution-note">Resolution note</label>
        <textarea id="resolution-note" name="note" required minLength={5} maxLength={1000} />
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save resolution'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
