import { FC, useSyncExternalStore } from 'react';
import {
  getConsent,
  isAnalyticsConfigured,
  setConsent,
  subscribeConsent,
} from '../services/analyticsConsent';

/**
 * Asks before any analytics runs.
 *
 * Both answers are one click and carry the same visual weight — a decline
 * that is harder to reach than an accept is not valid consent. There is no
 * dismiss control for the same reason: closing the question unanswered would
 * have to count as a "no", which reads as a bug to anyone who meant "yes".
 */
export const ConsentBanner: FC = () => {
  const consent = useSyncExternalStore(subscribeConsent, getConsent);

  if (!isAnalyticsConfigured() || consent !== null) return null;

  const buttonClass =
    'flex-1 rounded-lg border border-stone-300 bg-white px-4 py-1.5 font-serif ' +
    'text-[13.5px] text-stone-800 transition-colors hover:border-stone-500 ' +
    'hover:bg-stone-100 sm:flex-none';

  return (
    <div
      role="region"
      aria-label="Analytics consent"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4"
    >
      <div className="pointer-events-auto flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-stone-200 bg-paper p-4 shadow-[0_8px_24px_rgba(28,25,23,0.12)] sm:flex-row sm:items-center sm:gap-4">
        <p className="flex-1 font-serif text-[13px] leading-relaxed text-stone-600">
          We would like to use Google Analytics to count visits and see which parts of Talleyrand
          get used. It stores a cookie in your browser, and never receives your questions, answers,
          or documents. You can change your mind at any time.
        </p>
        <div className="flex flex-shrink-0 gap-2">
          <button type="button" onClick={() => setConsent('denied')} className={buttonClass}>
            Decline
          </button>
          <button type="button" onClick={() => setConsent('granted')} className={buttonClass}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};
