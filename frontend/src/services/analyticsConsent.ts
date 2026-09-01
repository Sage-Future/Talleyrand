/**
 * Consent for the analytics tag.
 *
 * Analytics is not needed to run the app, so EU and UK cookie rules forbid it
 * from loading before the visitor has agreed: the tag is injected on "accept"
 * and never otherwise. Declining, or withdrawing later, sets Google's own kill
 * switch and clears the cookies the tag had written.
 *
 * The stored choice is the one piece of state kept without asking. That is
 * allowed — it exists only because the visitor answered the question, and
 * forgetting it would mean asking again on every page.
 *
 * A deployment built without VITE_GA_MEASUREMENT_ID has no analytics at all,
 * so there is nothing to consent to and no banner ever appears.
 */

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

const CONSENT_STORAGE_KEY = 'analytics_consent';

export type ConsentChoice = 'granted' | 'denied';

const measurementId = (): string | null => {
  const id = import.meta.env.VITE_GA_MEASUREMENT_ID;
  return id && /^G-[A-Z0-9]+$/.test(id) ? id : null;
};

/** Whether this deployment collects analytics at all. */
export const isAnalyticsConfigured = (): boolean => measurementId() !== null;

/** The visitor's choice, or null while they have not made one. */
export const getConsent = (): ConsentChoice | null => {
  const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
  return stored === 'granted' || stored === 'denied' ? stored : null;
};

let tagLoaded = false;

const loadTag = (id: string): void => {
  if (tagLoaded) return;
  tagLoaded = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag.js reads the arguments object itself, so it cannot take an array.
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', id);

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);
};

/** Google's documented kill switch: gtag.js checks it before every hit. */
const setDisableFlag = (id: string, disabled: boolean): void => {
  (window as unknown as Record<string, boolean>)[`ga-disable-${id}`] = disabled;
};

const deleteAnalyticsCookies = (): void => {
  const names = document.cookie
    .split(';')
    .map(cookie => cookie.split('=')[0].trim())
    .filter(name => name.startsWith('_ga'));

  // A cookie can only be expired from the exact domain it was set on, and the
  // browser does not let script read that domain back. The tag uses the
  // registrable domain (.talleyrand.app) rather than the host, so expire each
  // name against every suffix of the hostname as well as the host itself; the
  // browser ignores the attempts naming a domain this page cannot write.
  const labels = window.location.hostname.split('.');
  const scopes = ['', ...labels.map((_, i) => `; domain=.${labels.slice(i).join('.')}`)];

  for (const name of names) {
    for (const scope of scopes) {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT${scope}`;
    }
  }
};

const listeners = new Set<() => void>();

const apply = (choice: ConsentChoice | null): void => {
  const id = measurementId();
  if (!id) return;

  if (choice === 'granted') {
    setDisableFlag(id, false);
    loadTag(id);
  } else {
    // Unanswered counts as denied: nothing may run before an explicit yes.
    setDisableFlag(id, true);
    deleteAnalyticsCookies();
  }
};

/**
 * Settle analytics on startup: load the tag for a visitor who has already
 * accepted, and for everyone else make sure nothing is running and clear any
 * analytics cookies still on the browser — earlier builds set them before
 * there was a question to answer.
 */
export const initAnalytics = (): void => {
  apply(getConsent());
};

export const setConsent = (choice: ConsentChoice): void => {
  localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  apply(choice);
  listeners.forEach(listener => listener());
};

/** Forget the choice and stop analytics, so the banner asks again. */
export const resetConsent = (): void => {
  localStorage.removeItem(CONSENT_STORAGE_KEY);
  apply(null);
  listeners.forEach(listener => listener());
};

export const subscribeConsent = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
