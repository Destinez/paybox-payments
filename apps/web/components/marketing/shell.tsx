import { MarketingFooter } from './footer';
import { MarketingHeader } from './header';

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing">
      <link rel="preload" href="/fonts/sora-600.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <a className="skip-link" href="#marketing-main">
        Skip to content
      </a>
      <MarketingHeader />
      <main id="marketing-main">{children}</main>
      <MarketingFooter />
    </div>
  );
}
