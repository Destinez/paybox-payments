'use client';
import { useState } from 'react';
import { api, date, useResource } from '../lib/api';
import type { User } from '../lib/types';
import { ErrorNotice, Modal } from './ui';
export function Settings({ user }: { user: User | null }) {
  const keys = useResource<{
      data: { id: string; prefix: string; revoked_at: string | null; created_at: string }[];
    }>(user?.role === 'admin' ? '/admin/keys' : null),
    users = useResource<{ data: User[] }>(user?.role === 'admin' ? '/admin/users' : null),
    merchants = useResource<{ data: { id: string; name: string }[] }>(
      user?.role === 'admin' ? '/admin/merchants' : null,
    );
  const [modal, setModal] = useState(''),
    [error, setError] = useState(''),
    [issued, setIssued] = useState('');
  if (user?.role !== 'admin') return <ErrorNotice message="Only administrators can manage access." />;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h1>Access & settings</h1>
          <p>Manage the people and systems that can access Paybox.</p>
        </div>
      </div>
      <ErrorNotice message={error || keys.error || users.error} />
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Merchant API keys</h2>
            <p>Only key prefixes are stored for display. Full keys are shown once.</p>
          </div>
          <button type="button" className="button primary" onClick={() => setModal('key')}>
            Create API key
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Prefix</th>
                <th>Created</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {keys.data?.data.map((key) => (
                <tr key={key.id}>
                  <td className="mono">{key.prefix}…</td>
                  <td>{date(key.created_at)}</td>
                  <td>{key.revoked_at ? 'Revoked' : 'Active'}</td>
                  <td>
                    <button
                      className="button small secondary"
                      type="button"
                      disabled={!!key.revoked_at}
                      onClick={async () => {
                        try {
                          await api(`/admin/keys/${key.id}`, { method: 'DELETE' });
                          keys.refresh();
                        } catch (error) {
                          setError((error as Error).message);
                        }
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel settings-users">
        <div className="panel-title">
          <div>
            <h2>Team members</h2>
            <p>Viewers read. Operators replay and resolve. Administrators manage access.</p>
          </div>
          <button type="button" className="button secondary" onClick={() => setModal('user')}>
            Add user
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.data.map((row) => (
                <tr key={row.id}>
                  <td>{row.email}</td>
                  <td className="capitalize">{row.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {issued && (
        <Modal title="Save your API key" onClose={() => setIssued('')}>
          <p>This key is shown once. Store it securely.</p>
          <code className="issued-key">{issued}</code>
          <button
            className="button primary"
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(issued);
            }}
          >
            Copy key
          </button>
        </Modal>
      )}
      {modal && (
        <Modal title={modal === 'key' ? 'Create API key' : 'Add team member'} onClose={() => setModal('')}>
          <form
            className="form"
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              try {
                if (modal === 'key') {
                  const result = await api<{ key: string }>('/admin/keys', {
                    method: 'POST',
                    body: JSON.stringify({ merchant_id: data.get('merchant') }),
                  });
                  setIssued(result.key);
                  keys.refresh();
                } else {
                  await api('/admin/users', {
                    method: 'POST',
                    body: JSON.stringify({
                      email: data.get('email'),
                      password: data.get('password'),
                      role: data.get('role'),
                    }),
                  });
                  users.refresh();
                }
                setModal('');
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          >
            {modal === 'key' ? (
              <>
                <label htmlFor="key-merchant">Merchant</label>
                <select id="key-merchant" name="merchant">
                  {merchants.data?.data.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <label htmlFor="user-email">Email</label>
                <input id="user-email" name="email" type="email" required />
                <label htmlFor="user-password">Initial password (12+ characters)</label>
                <input
                  id="user-password"
                  name="password"
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
                <label htmlFor="user-role">Role</label>
                <select id="user-role" name="role">
                  <option value="viewer">Viewer</option>
                  <option value="ops">Operator</option>
                  <option value="admin">Administrator</option>
                </select>
              </>
            )}
            <ErrorNotice message={error} />
            <div className="modal-actions">
              <button className="button primary" type="submit">
                Create
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
