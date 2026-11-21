import { Mail, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import { ContactForm } from '../../../components/marketing/contact-form';
import { contactEmail, PageIntro, repository } from '../../../components/marketing/shared';

export const metadata: Metadata = {
  title: 'Contact the builder',
  description:
    'Contact Obaro Destiny Udurie in Lagos about Paybox, a demo walkthrough, integration questions or engineering opportunities.',
};

export default function Contact() {
  return (
    <div className="mkt-container">
      <PageIntro label="Let’s talk" title="Good systems start with a conversation.">
        Email Obaro directly about an integration or walkthrough. If you prefer a guided draft, the form opens
        your email app; Paybox does not send a message.
      </PageIntro>
      <div className="mkt-contact-grid">
        <aside className="mkt-contact-details">
          <h2>A direct line to the builder.</h2>
          <p>
            Obaro Destiny Udurie
            <br />
            Full-stack engineer
          </p>
          <a href={`mailto:${contactEmail}`}>
            <Mail size={18} aria-hidden="true" />
            {contactEmail}
          </a>
          <p className="mkt-builder-location">
            <MapPin size={18} aria-hidden="true" />
            Lagos, Nigeria · Africa/Lagos
          </p>
          <div className="mkt-contact-note">
            <h3>Prefer to explore first?</h3>
            <p>The source and complete local walkthrough are public.</p>
            <a className="mkt-text-link" href={repository}>
              Open the repository
            </a>
          </div>
          <p className="mkt-small">Please keep card details, API keys and passwords out of your message.</p>
        </aside>
        <ContactForm />
      </div>
    </div>
  );
}
