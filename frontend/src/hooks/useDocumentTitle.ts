import { useEffect } from 'react';

/**
 * The tab's title on a page that names nothing of its own, and the suffix on
 * every page that does.
 */
export const SITE_NAME = 'Talleyrand';

/**
 * Names the browser tab — and with it the bookmark, the history entry and the
 * window the visitor tabs back to.
 *
 * Pass null while the name is still loading, so a case opens on the bare site
 * name rather than flashing a placeholder. The title is put back on unmount,
 * so a route that names nothing never inherits the previous route's name.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE_NAME}` : SITE_NAME;

    return () => {
      document.title = SITE_NAME;
    };
  }, [title]);
}
