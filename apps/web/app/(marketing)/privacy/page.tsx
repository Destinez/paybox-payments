import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '../../../components/marketing/legal-page';

export const metadata: Metadata = {
  title: 'Privacy notice',
  description:
    'How the Paybox portfolio demo handles sessions, hashed API keys, webhook payloads, contact drafts, retention and privacy requests in Nigeria.',
};
const sections: LegalSection[] = [
  {
    id: 'controller',
    title: 'Who is responsible',
    paragraphs: [
      'Obaro Destiny Udurie, based in Lagos, Nigeria, maintains this portfolio website and is the controller for information provided to the maintained demo or sent directly to him. Contact: obarodestinez@gmail.com.',
      'Paybox is a test-mode demonstration, not a live payment service. If you self-host the source, you control your own instance and its data; publish a notice that reflects your deployment and responsibilities.',
    ],
  },
  {
    id: 'data',
    title: 'What the demo stores',
    paragraphs: [
      'The operations database stores user email addresses, password hashes, roles, session-token hashes and expiry times. Merchant API keys are stored as hashes with identifying prefixes, rather than as plaintext keys in the database.',
      'Test payment records can include customer email, merchant identity, payment reference, amount, currency, status, refund reason and timestamps. Webhook receipts preserve raw payload bytes, their hashes and processing metadata. Delivery attempts, immutable ledger entries, reconciliation findings and operator audit records support investigation.',
      'For x402, the demo records public wallet addresses, route details, signed authorization metadata and testnet or simulated settlement receipts. Public blockchain data may also be visible through the network and cannot be erased by this website. Never submit real card details or private wallet keys.',
    ],
  },
  {
    id: 'purpose',
    title: 'Why information is used',
    paragraphs: [
      'Information supports sign-in, access control, test payment verification, accounting, delivery recovery, abuse prevention and the demonstration audit trail. These uses support requested demo access and the legitimate interest of operating and securing the portfolio, subject to applicable law.',
      'The public marketing pages do not require sign-in. There are no advertising trackers or analytics integrations added to this website. Hosting infrastructure may process connection addresses, request paths and diagnostic metadata to serve and protect the site.',
    ],
  },
  {
    id: 'sharing',
    title: 'Contact and service providers',
    paragraphs: [
      'The contact form validates and prepares an email draft in your browser. It does not submit the message to Paybox. If you choose to send it, your email provider and the maintainer’s email provider process it to deliver and retain the correspondence.',
      'In Paystack test mode, checkout is hosted by Paystack and test verification requests go to Paystack. In x402 testnet mode, authorization and settlement requests go to the configured testnet facilitator, and priced requests go to the configured merchant upstream. The offline demo uses local simulations instead.',
      'The maintainer does not sell personal information. Hosting, email or test-provider services may process information outside Nigeria under their own terms. Avoid using real customer data in this demonstration.',
    ],
  },
  {
    id: 'retention',
    title: 'Retention and removal',
    paragraphs: [
      'Sessions expire after eight hours, and signing out deletes the current server-side session record. Expired session records may remain in the database. Idempotency records expire after 24 hours and are purged by the worker.',
      'Payment records, raw webhook payloads, journals, delivery histories and audit records otherwise persist for the lifetime of the demonstration database. There is no automatic short-term deletion schedule for these records. Local self-hosted data remains until the operator resets or removes it.',
      'Ledger entries are immutable. Removing a demo dataset may require resetting the instance instead of editing an individual journal. Email correspondence is retained while the discussion is relevant or a legal obligation requires it; you can request its deletion.',
    ],
  },
  {
    id: 'rights',
    title: 'Your choices and rights',
    paragraphs: [
      'This notice follows the transparency, purpose limitation and data minimisation principles of Nigeria’s data-protection framework, including the NDPR and the Nigeria Data Protection Act 2023. It is not a claim of regulatory certification.',
      'You may request access, correction, deletion or restriction where applicable, object to relevant processing, or withdraw consent for optional correspondence. Email obarodestinez@gmail.com with the instance and reference concerned, avoiding secrets. Identity and lawful retention requirements may limit what can be changed.',
      'If your concern remains unresolved, you may contact the Nigeria Data Protection Commission. Material changes to this notice will carry an updated effective date.',
    ],
  },
];

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy notice"
      introduction="A clear account of the information behind this portfolio demo, how it is used and the choices you have."
      sections={sections}
    />
  );
}
