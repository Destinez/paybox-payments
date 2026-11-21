import type { Metadata } from 'next';
import { Dashboard } from '../../components/dashboard';

export const metadata: Metadata = {
  title: 'Operations dashboard',
  description: 'Review verified payments, ledger activity and delivery health in the Paybox test workspace.',
};

export default function Page() {
  return <Dashboard />;
}
