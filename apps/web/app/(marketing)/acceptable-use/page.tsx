import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '../../../components/marketing/legal-page';

export const metadata: Metadata = {
  title: 'Acceptable use',
  description:
    'Use the Paybox demo responsibly: synthetic test data, no card submission, authorised access, API rate limits and safe webhook testing.',
};
const sections: LegalSection[] = [
  {
    id: 'evaluation',
    title: 'Use it to learn and evaluate',
    paragraphs: [
      'Paybox is a portfolio demonstration maintained by Obaro Destiny Udurie in Lagos, Nigeria. Use it for lawful testing, product evaluation and integration learning with synthetic data and test credentials.',
      'Run failure injection, load experiments and destructive scenarios on an instance you control. Obtain the maintainer’s agreement before security testing or load testing a maintained public demo.',
    ],
  },
  {
    id: 'sensitive-data',
    title: 'Keep sensitive data out',
    paragraphs: [
      'Never submit card numbers, CVVs, PINs, bank passwords, private wallet keys or live provider credentials to Paybox APIs, webhook payloads or the contact form. Paystack-hosted checkout handles card entry in test mode; the local fake checkout collects no card details.',
      'Do not upload real customer datasets or use the demo to represent real settlement, payouts or stored value. Paybox supports only test-mode payments and offline or Base Sepolia x402 activity.',
    ],
  },
  {
    id: 'api',
    title: 'Respect API boundaries',
    paragraphs: [
      'Do not flood endpoints, evade limits, automate credential guessing, forge signatures or replay requests to cause unauthorised side effects. Do not interfere with another merchant’s data or attempt to exceed your assigned role.',
      'The current API allows 120 requests per minute per merchant key and ten login attempts per fifteen minutes per connection address and normalised email. A 429 response includes Retry-After; honour it. Self-hosting or pilot discussions do not override these implemented limits.',
    ],
  },
  {
    id: 'delivery',
    title: 'Test webhooks responsibly',
    paragraphs: [
      'Only register webhook and upstream destinations you control or are authorised to use. Do not configure destinations for scanning, spam, malware delivery or requests to private systems without permission.',
      'Verify outbound signatures and deduplicate stable event IDs in receivers. Delivery is at least once. Manual replay preserves prior attempts and is intended for recovery, not for multiplying side effects.',
    ],
  },
  {
    id: 'enforcement',
    title: 'Access and reporting',
    paragraphs: [
      'The maintainer may limit access, revoke demo credentials or suspend the demonstration to prevent abuse or protect its operation. Demo records may be reviewed for investigation or reset in accordance with the privacy notice and terms.',
      'Report a concern to obarodestinez@gmail.com with a minimal description and safe reproduction steps. Do not include secrets or exploit data belonging to someone else. These rules are subject to Nigerian law and do not limit rights that cannot lawfully be limited.',
    ],
  },
];

export default function AcceptableUse() {
  return (
    <LegalPage
      title="Acceptable use"
      introduction="A useful demo depends on reasonable testing, authorised access and respect for the data boundary."
      sections={sections}
    />
  );
}
