import Link from 'next/link';
import { repository } from './shared';

const groups = [
  {
    title: 'Product',
    links: [
      ['Product deep-dive', '/product'],
      ['Workspace sign-in', '/login'],
      ['Security', '/security'],
    ],
  },
  {
    title: 'Docs',
    links: [
      ['Developer guide', '/developers'],
      ['Self-host / pilot', '/pricing'],
      ['Repository history', '/changelog'],
    ],
  },
  {
    title: 'x402',
    links: [
      ['Paid endpoints', '/product#x402'],
      ['Testnet boundaries', '/security'],
      ['Gateway decision', `${repository}/blob/main/docs/adr/x402-gateway.md`],
    ],
  },
  {
    title: 'Repo',
    links: [
      ['View on GitHub', repository],
      ['About the builder', '/about'],
      ['Contact / pilot', '/contact'],
    ],
  },
];
export function MarketingFooter() {
  return (
    <footer className="mkt-footer">
      <div className="mkt-container">
        <div className="mkt-footer-grid">
          {groups.map((group) => (
            <div key={group.title}>
              <h2>{group.title}</h2>
              <ul>
                {group.links.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href!}>{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mkt-footer-bottom">
          <span>© {new Date().getFullYear()} Obaro Destiny Udurie · Test mode only</span>
          <nav aria-label="Legal">
            {[
              ['Privacy', '/privacy'],
              ['Terms', '/terms'],
              ['Cookies', '/cookies'],
              ['Acceptable use', '/acceptable-use'],
            ].map(([label, href]) => (
              <Link href={href!} key={label}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
