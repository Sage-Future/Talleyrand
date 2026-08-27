import type { FC } from 'react';

/**
 * The Talleyrand mark: a serif question mark, matching the favicon.
 * It is a real Newsreader glyph, so it sits on the baseline of adjacent
 * serif text without the optical nudge that icon glyphs need.
 * Sized with a text-* class; the caller also supplies the colour.
 */
export const BrandMark: FC<{ className?: string }> = ({ className = '' }) => (
  <span aria-hidden className={`font-serif font-semibold leading-none ${className}`}>
    ?
  </span>
);
