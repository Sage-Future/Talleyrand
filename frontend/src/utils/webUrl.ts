/**
 * The parsed URL, but only for the schemes a link built from case data may use.
 *
 * Case data is untrusted. A case arrives from a share link or from a
 * hand-written JSON import, so a source URL can say anything — `javascript:`
 * included — and React renders an href verbatim. Links inside answer text are
 * safe only because react-markdown sanitizes them; anything that builds an
 * href itself has to come through here and fall back to plain text on null.
 */
export const httpUrl = (raw: unknown): URL | null => {
  if (typeof raw !== 'string') return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // Reading the protocol off the parse rather than the raw string: the URL
  // parser has already stripped the leading whitespace and control characters
  // that hide a scheme from a prefix check ('java\tscript:' among them).
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
};
