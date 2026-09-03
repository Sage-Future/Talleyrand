import { FC, ReactNode, useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { BrandMark } from '../BrandMark';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/** The organisation behind talleyrand.app, as named on both legal pages. */
export const OPERATOR = 'Sage Future Inc';
export const CONTACT_EMAIL = 'talleyrand@sage-future.org';
export const POSTAL_ADDRESS = '8 The Green, Suite #4976, Dover, Delaware 19901, United States';

/**
 * The frame around the privacy policy and the terms: the landing page's header
 * and palette around one column of prose. Both are plain routes of the SPA so
 * that each has a stable public address (Google's OAuth consent screen needs
 * one for the policy) and the same look as the rest of the site.
 */
export const LegalLayout: FC<{ title: string; updated: string; children: ReactNode }> = ({
  title,
  updated,
  children,
}) => {
  const { hash } = useLocation();

  useDocumentTitle(title);

  // Client-side navigation keeps the previous page's scroll position, which
  // would open a policy reached from the landing footer at its very bottom.
  // A hash (the consent banner links straight to the analytics section) wins
  // over the top of the page.
  useEffect(() => {
    const target = hash ? document.getElementById(hash.slice(1)) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [hash]);

  return (
    <div className="min-h-screen bg-parchment font-serif text-stone-800">
      <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-parchment/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-[19px] font-semibold tracking-tight text-stone-900"
          >
            <BrandMark className="text-[22px] text-orange-500" />
            Talleyrand
          </Link>
          <nav className="flex items-center gap-5 text-[15px] font-medium">
            <NavLink to="/privacy" className={navLinkClass}>
              Privacy
            </NavLink>
            <NavLink to="/terms" className={navLinkClass}>
              Terms
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 pb-24 pt-14">
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-stone-900">
          {title}
        </h1>
        <p className="mt-3 text-[14px] text-stone-400">Last updated {updated}</p>
        <article className={PROSE}>{children}</article>
      </main>

      <footer className="border-t border-stone-200/70 py-8 text-center text-sm text-stone-400">
        &copy; {new Date().getFullYear()} Talleyrand · built by{' '}
        <a
          href="https://sage-future.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-600"
        >
          Sage
        </a>
      </footer>
    </div>
  );
};

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `transition-colors hover:text-stone-900 ${isActive ? 'text-stone-900' : 'text-stone-500'}`;

// The workspace's editorial prose, tuned for a long legal text: generous
// section spacing, headings that clear the sticky header when linked to, and
// quiet underlined links.
const PROSE =
  'prose prose-stone mt-10 max-w-none font-serif text-[16.5px] leading-relaxed ' +
  'prose-headings:scroll-mt-24 prose-headings:font-serif prose-headings:font-semibold ' +
  'prose-headings:tracking-tight prose-headings:text-stone-900 ' +
  'prose-h2:mt-14 prose-h2:text-[26px] prose-h3:mt-9 prose-h3:text-[19px] ' +
  'prose-p:text-stone-700 prose-li:text-stone-700 prose-li:my-1.5 ' +
  'prose-a:font-normal prose-a:text-stone-900 prose-a:decoration-stone-300 prose-a:underline-offset-2 ' +
  'hover:prose-a:decoration-orange-400 prose-strong:text-stone-900 ' +
  'prose-th:text-[13px] prose-th:font-medium prose-th:uppercase prose-th:tracking-[0.08em] prose-th:text-stone-400 ' +
  'prose-td:align-top prose-td:text-[15px] prose-td:text-stone-700 ' +
  'prose-code:rounded prose-code:bg-stone-200/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[14px] prose-code:font-normal prose-code:text-stone-700';
