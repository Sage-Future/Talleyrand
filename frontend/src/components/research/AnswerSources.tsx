import { FC, ReactNode, useState } from 'react';
import type { WebSource } from '../../types';
import { httpUrl } from '../../utils/webUrl';

/** decodeURI rejects a path holding a bare '%', which plenty of real URLs do;
 * one of those must read a little worse, not take the answer down with it. */
function readablePath(pathname: string): string {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

/**
 * Turns a source URL into something readable. Titles only come with results
 * Claude found or the answer cited, so most rows are named by their domain
 * with the path as the quieter half.
 */
function describe(source: WebSource, url: URL | null): { primary: string; secondary: string } {
  if (url === null) {
    // Search results come from outside; one this list won't link to — an
    // unparseable URL, or a scheme other than http(s) — is still shown.
    return { primary: source.title ?? source.url, secondary: '' };
  }

  const domain = url.hostname.replace(/^www\./, '');
  const path = readablePath(url.pathname).replace(/\/$/, '');
  if (source.title) {
    return { primary: source.title, secondary: domain };
  }
  return { primary: domain, secondary: path };
}

/**
 * The line above the list. A search-heavy answer can surface more pages than
 * are worth keeping, so the count and the list can disagree — when they do,
 * the count wins and the line says how much of it is actually shown.
 */
function summarize(found: number, cited: number, listed: number): string {
  const looked = found - cited;
  const trimmed = found > listed ? ` (${listed - cited} of them listed)` : '';
  if (cited === 0) return `${looked} looked at, none cited in the answer${trimmed}`;
  if (looked === 0) return `${cited} cited in the answer`;
  return `${cited} cited in the answer · ${looked} more looked at${trimmed}`;
}

const Dot: FC<{ cited: boolean }> = ({ cited }) => (
  <span
    className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
      cited ? 'bg-stone-400' : 'border border-stone-300'
    }`}
  />
);

/**
 * What the web searches behind an answer turned up, folded away beneath it.
 *
 * The sources the answer cites are already linked inline in its text, so what
 * this adds is the rest: the pages the model was shown and passed over. Renders
 * nothing for an answer written without a web search.
 *
 * Sits in the answer's footer row alongside the other controls, so it returns
 * the trigger and the list as siblings: the parent must be a flex-wrap row, in
 * which the full-width list falls to a line of its own below the controls.
 */
export const AnswerSources: FC<{ sources: WebSource[]; found: number }> = ({ sources, found }) => {
  const [expanded, setExpanded] = useState(false);

  if (sources.length === 0) return null;

  const cited = sources.filter(source => source.cited).length;
  // Cases answered before the count was recorded only know their own list.
  const total = Math.max(found, sources.length);

  return (
    <>
      <button
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center gap-1 rounded-md px-1.5 py-0.5 font-serif text-[12.5px] text-stone-400 transition-colors hover:bg-stone-200/50 hover:text-stone-700"
        data-tooltip={expanded ? 'Hide the sources' : 'Everything the searches turned up'}
      >
        <svg
          className={`icon-optical h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
        {total} {total === 1 ? 'source' : 'sources'}
      </button>

      {expanded && (
        <div className="order-last mt-0.5 w-full border-l border-stone-200 pl-3">
          <div className="font-serif text-[11.5px] text-stone-400">
            {summarize(total, cited, sources.length)}
          </div>
          <ul className="mt-1 max-h-64 overflow-y-auto pr-1">
            {sources.map(source => {
              const url = httpUrl(source.url);
              const { primary, secondary } = describe(source, url);
              const line = `flex items-center gap-1.5 py-[3px] font-serif text-[12.5px] ${
                source.cited ? 'text-stone-600' : 'text-stone-400'
              }`;
              const row: ReactNode = (
                <>
                  <Dot cited={source.cited} />
                  <span className="min-w-0 truncate group-hover:underline">{primary}</span>
                  {secondary && (
                    <span className="min-w-0 truncate text-[11.5px] text-stone-300">
                      {secondary}
                    </span>
                  )}
                  {source.pageAge && (
                    <span className="ml-auto flex-shrink-0 pl-2 text-[11.5px] text-stone-300">
                      {source.pageAge}
                    </span>
                  )}
                </>
              );
              return (
                <li key={source.url}>
                  {url ? (
                    <a
                      href={url.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`group ${line}`}
                    >
                      {row}
                    </a>
                  ) : (
                    // Nothing safe to point at, so the row is text: no anchor,
                    // and without the 'group' class no hover state promising one.
                    <span className={line}>{row}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
};
