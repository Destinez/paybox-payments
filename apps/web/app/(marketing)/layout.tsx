import { MarketingShell } from '../../components/marketing/shell';
import './marketing.css';
import './trace.css';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <MarketingShell>{children}</MarketingShell>;
}
