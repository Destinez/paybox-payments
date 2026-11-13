import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Paybox Payments', description: 'Payment operations, accounted for.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
