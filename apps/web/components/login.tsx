'use client';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { ErrorNotice } from './ui';
export function Login() {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <section className="login-story">
        <a className="brand" href="/">
          {' '}
          <span className="brand-mark" />
          paybox<span className="brand-dot">.</span>
        </a>
        <div>
          <span className="eyebrow">PAYMENT OPERATIONS</span>
          <h1>
            Every payment.
            <br />
            Accounted for.
          </h1>
          <p>A clear view of money moving through your business, from checkout to reconciliation.</p>
          <div className="story-ledger">
            <span>Payment received</span>
            <strong>₦15,000.00</strong>
            <span>Ledger posted</span>
            <strong className="story-check">
              <ShieldCheck size={18} /> Balanced
            </strong>
            <span>Nothing left to guess.</span>
          </div>
        </div>
        <small>Built in Lagos. Designed for trust.</small>
      </section>
      <section className="login-panel">
        <div className="login-form">
          <div className="lock-icon">
            <LockKeyhole size={22} />
          </div>
          <span className="eyebrow">OPERATIONS WORKSPACE</span>
          <h2>Welcome back</h2>
          <p>Sign in to your Paybox dashboard.</p>
          <ErrorNotice message={error} />
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              const data = new FormData(event.currentTarget);
              try {
                const result = await api<{ csrf_token: string }>('/session/login', {
                  method: 'POST',
                  body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
                });
                sessionStorage.setItem('paybox_csrf', result.csrf_token);
                window.location.assign('/');
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@company.com"
              required
            />
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
              <ArrowRight size={16} />
            </button>
          </form>
          <p className="login-note">
            <ShieldCheck size={14} /> Paystack test mode · No real money moves
          </p>
        </div>
        <footer>
          Paybox Payments <span>© {new Date().getFullYear()} Obaro Destiny Udurie</span>
        </footer>
      </section>
    </main>
  );
}
