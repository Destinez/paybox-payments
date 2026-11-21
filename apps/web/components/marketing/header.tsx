'use client';

import { ArrowUpRight, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const links = [
  { href: '/product', label: 'Product' },
  { href: '/developers', label: 'Developers' },
  { href: '/security', label: 'Security' },
  { href: '/about', label: 'About' },
];

export function MarketingHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        document.getElementById('marketing-menu-toggle')?.focus();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  return (
    <header className="mkt-header">
      <div className="mkt-container mkt-header-inner">
        <Link href="/" className="brand mkt-brand" aria-label="Paybox home" onClick={() => setOpen(false)}>
          <span className="brand-mark" aria-hidden="true" />
          paybox<span className="brand-dot">.</span>
        </Link>
        <nav className="mkt-nav" aria-label="Marketing">
          {links.map((link) => (
            <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="mkt-header-actions">
          <Link href="/login" className="mkt-button">
            Workspace sign-in <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
          <button
            id="marketing-menu-toggle"
            type="button"
            className="mkt-menu-toggle"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="marketing-mobile-nav"
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>
      <nav id="marketing-mobile-nav" className="mkt-mobile-nav" aria-label="Mobile marketing" hidden={!open}>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={pathname === link.href ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
            {link.label}
          </Link>
        ))}
        <Link href="/contact" onClick={() => setOpen(false)}>
          Contact
        </Link>
      </nav>
    </header>
  );
}
