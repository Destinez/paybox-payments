import { ShieldCheck } from 'lucide-react';

export const repository = 'https://github.com/Destinez/paybox-payments';
export const contactEmail = 'obarodestinez@gmail.com';

export function PageIntro({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mkt-page-intro">
      <p className="mkt-label">{label}</p>
      <h1>{title}</h1>
      <p className="mkt-lead">{children}</p>
    </div>
  );
}

export function DemoNote() {
  return (
    <p className="mkt-demo-note">
      <ShieldCheck size={15} aria-hidden="true" />
      Paystack test mode · Base Sepolia testnet · No real money
    </p>
  );
}
