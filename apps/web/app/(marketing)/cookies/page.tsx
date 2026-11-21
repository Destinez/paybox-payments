import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '../../../components/marketing/legal-page';

export const metadata: Metadata = {
  title: 'Cookie notice',
  description:
    'Paybox uses an essential eight-hour operations session cookie and tab-local CSRF storage. Public marketing pages add no analytics or ad trackers.',
};
const sections: LegalSection[] = [
  {
    id: 'public',
    title: 'Public pages and tracking',
    paragraphs: [
      'You can read the public marketing and legal pages without accepting a marketing cookie or signing in. This website adds no advertising cookies, analytics integrations or cross-site tracking pixels.',
      'Product screenshots are served from this site. Links to GitHub or your email app only open those services when you choose to follow them; their own policies then apply.',
    ],
  },
  {
    id: 'session',
    title: 'The operations session cookie',
    paragraphs: [
      'Signing in to the operations workspace creates paybox_session, an essential cookie containing an opaque session token. It is sent to this site, has an eight-hour lifetime and uses the path /. The server stores a hash of the token to identify the session.',
      'The cookie is HttpOnly and SameSite=Lax. On HTTPS deployments it is also Secure. It supports authentication and access control; it is not an advertising identifier. Signing out clears it and deletes the current server-side session record.',
    ],
  },
  {
    id: 'storage',
    title: 'Other browser storage',
    paragraphs: [
      'The operations interface stores paybox_csrf in sessionStorage for the current browser tab. It supplies the CSRF token for authenticated state-changing requests. Signing out removes it; closing the tab normally clears that tab’s storage.',
      'Pricing selection, the mobile menu and contact drafts use temporary interface state. They are not saved as tracking identifiers or sent as analytics events. The contact form prepares a mailto draft only after validation.',
    ],
  },
  {
    id: 'choices',
    title: 'Your choices',
    paragraphs: [
      'You can block or delete cookies and clear site storage in your browser. Public pages remain readable; blocking the essential session cookie prevents operations sign-in from working. To end an active session, use Sign out in the workspace.',
      'Obaro Destiny Udurie maintains this notice from Lagos, Nigeria. For questions, contact obarodestinez@gmail.com. If optional tracking is added in future, this notice and any required choice mechanism must be updated before it is enabled.',
    ],
  },
];

export default function Cookies() {
  return (
    <LegalPage
      title="Cookie notice"
      introduction="Essential storage for the workspace. A public website without advertising trackers."
      sections={sections}
    />
  );
}
