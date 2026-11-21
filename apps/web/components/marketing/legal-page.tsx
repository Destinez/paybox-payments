import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { contactEmail, PageIntro } from './shared';

export type LegalSection = { id: string; title: string; paragraphs: string[] };

export function LegalPage({
  title,
  introduction,
  sections,
}: {
  title: string;
  introduction: string;
  sections: LegalSection[];
}) {
  return (
    <div className="mkt-container">
      <PageIntro label="The demo, clearly explained" title={title}>
        {introduction}
      </PageIntro>
      <p className="doc-updated">Last updated 17 November 2026 · Obaro Destiny Udurie · Lagos, Nigeria</p>
      <div className="doc-layout">
        <aside className="doc-rail">
          <nav aria-label="On this page">
            <p className="mono-label">On this page</p>
            <ol>
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
        <article className="doc-copy mkt-legal-copy">
          {sections.map((section, index) => (
            <section id={section.id} key={section.id}>
              <h2>
                <span className="doc-num">{String(index + 1).padStart(2, '0')}</span>
                {section.title}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
          <div className="mkt-legal-contact">
            <h2>Questions about this notice?</h2>
            <p>
              Contact Obaro Destiny Udurie at <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
            </p>
            <Link className="mkt-text-link" href="/contact">
              Prepare a message <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
}
