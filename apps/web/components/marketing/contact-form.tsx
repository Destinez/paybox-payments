'use client';

import { ArrowRight, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { contactEmail } from './shared';

export function ContactForm() {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="mkt-contact-form">
      <h2>Tell me what you’re working on.</h2>
      <p>This form prepares an email draft in your browser. You send it from your own email app.</p>
      <form
        onChange={() => {
          setDraft('');
          setError('');
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const name = String(data.get('name') ?? '').trim();
          const email = String(data.get('email') ?? '').trim();
          const message = String(data.get('message') ?? '').trim();
          if (name.length < 2 || message.length < 20) {
            setError('Please enter your name and a message of at least 20 characters.');
            setDraft('');
            return;
          }
          const subject = `Paybox: ${data.get('topic')}`;
          const body = `Name: ${name}\nReply email: ${email}\n\n${message}`;
          setDraft(
            `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
          );
        }}
      >
        <div className="mkt-form-row">
          <div>
            <label htmlFor="contact-name">Your name</label>
            <input
              id="contact-name"
              name="name"
              autoComplete="name"
              minLength={2}
              maxLength={100}
              required
              placeholder="Ada Okafor"
            />
          </div>
          <div>
            <label htmlFor="contact-email">Email address</label>
            <input
              id="contact-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              placeholder="ada@company.com"
            />
          </div>
        </div>
        <label htmlFor="contact-topic">What would you like to discuss?</label>
        <select id="contact-topic" name="topic">
          <option>Product walkthrough</option>
          <option>Self-hosting and integration</option>
          <option>Pilot integration</option>
          <option>Engineering opportunity</option>
          <option>Privacy request</option>
        </select>
        <label htmlFor="contact-message">Your message</label>
        <textarea
          id="contact-message"
          name="message"
          minLength={20}
          maxLength={2000}
          required
          placeholder="Tell me a little about your project or question…"
          aria-describedby="contact-message-help"
        />
        <small id="contact-message-help">20–2,000 characters. No sensitive payment data.</small>
        {error && (
          <p className="mkt-form-error" role="alert">
            {error}
          </p>
        )}
        <button className="mkt-button" type="submit">
          Prepare email draft <ArrowRight size={17} aria-hidden="true" />
        </button>
        <p className="mkt-form-privacy">
          Your draft stays in this browser until you open your email app.{' '}
          <Link href="/privacy">Read the privacy notice.</Link>
        </p>
      </form>
      {draft && (
        <div className="mkt-form-success">
          <p role="status">
            <CheckCheck size={19} aria-hidden="true" />
            Your draft is ready. Open your email app to review and send it.
          </p>
          <a className="mkt-button mkt-button-secondary" href={draft}>
            Open email app <ArrowRight size={17} aria-hidden="true" />
          </a>
          <small>No message has been sent by Paybox.</small>
        </div>
      )}
    </div>
  );
}
