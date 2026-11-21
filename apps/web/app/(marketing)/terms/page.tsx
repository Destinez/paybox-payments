import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '../../../components/marketing/legal-page';

export const metadata: Metadata = {
  title: 'Terms of use',
  description:
    'Paybox demo terms: test mode only, no real money, pilot evaluation, service limitations, self-hosting and Nigerian jurisdiction.',
};
const sections: LegalSection[] = [
  {
    id: 'scope',
    title: 'A portfolio demonstration',
    paragraphs: [
      'Paybox is maintained by Obaro Destiny Udurie in Lagos, Nigeria. These terms apply to this website and the maintained demonstration. By using the demonstration, you agree to use it for lawful evaluation and learning.',
      'Paybox is not a bank, a payment-service licence holder, a custodian or a live merchant-processing service. No real money moves through this demo. Do not rely on its records as evidence of a real payment.',
    ],
  },
  {
    id: 'test-mode',
    title: 'Test mode only',
    paragraphs: [
      'The service uses a local fake processor or Paystack test mode. x402 uses offline simulation or Base Sepolia testnet and test USDC. Live Paystack keys and mainnet configuration are refused.',
      'Use synthetic data and test credentials. Do not submit card numbers, CVVs, banking credentials, private wallet keys or real customer payment data. Test tokens and simulated receipts do not represent funds held by Paybox.',
    ],
  },
  {
    id: 'access',
    title: 'Access and reasonable use',
    paragraphs: [
      'Operations access is restricted to authorised demo users and assigned roles. Keep login credentials and API keys private. Do not bypass access checks, rate limits, signature verification or other controls.',
      'The acceptable-use notice forms part of these terms. Access may be limited or suspended to address abuse, maintenance or the end of the demonstration. Contact the maintainer if you need a planned evaluation.',
    ],
  },
  {
    id: 'availability',
    title: 'Self-hosting, pilots and availability',
    paragraphs: [
      'The complete source is available for self-hosted evaluation. You are responsible for hosting costs. A pilot requires directly agreed scope and terms; the website does not sell subscriptions or offer live payment processing.',
      'The demo is provided as available. Data may be reset, features may change and the service may be unavailable without notice. There is no support-response commitment, uptime SLA, production suitability guarantee or promise of uninterrupted retention.',
    ],
  },
  {
    id: 'source',
    title: 'Source code and responsibility',
    paragraphs: [
      'The published source is licensed under the MIT license; the repository’s license governs use of that code. These website terms do not remove the rights granted by that license.',
      'A self-hosting operator is responsible for their own hosting, secrets, access, data handling and legal obligations. Third-party services such as Paystack, hosting providers and testnet facilitators have separate terms. Product screenshots show test data and do not represent real merchant activity or endorsements.',
    ],
  },
  {
    id: 'law',
    title: 'Limits, governing law and contact',
    paragraphs: [
      'To the extent permitted by law, the maintained demo is provided without warranties, and the maintainer is not responsible for losses arising from reliance on test data, interruptions or third-party services. Nothing excludes rights or liability that cannot lawfully be excluded.',
      'These terms are governed by Nigerian law. Subject to mandatory rights and applicable law, disputes may be brought before the competent courts in Lagos, Nigeria. Contact obarodestinez@gmail.com first to seek a practical resolution.',
      'Material changes will be reflected in the effective date. Continued use after publication of updated terms is subject to those terms.',
    ],
  },
];

export default function Terms() {
  return (
    <LegalPage
      title="Terms of use"
      introduction="The boundaries for exploring Paybox: test money, synthetic data and a service built for demonstration."
      sections={sections}
    />
  );
}
