import { FC, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import type { DeclineReason } from '../types';
import { BrandMark } from './BrandMark';
import { DECLINE_REASONS } from './research/declineReasons';
import { iconTooltip } from './ui/TooltipLayer';
import { isAnalyticsConfigured, resetConsent } from '../services/analyticsConsent';
import { REPO_URL } from '../config/constants';

/**
 * Public landing page. It mirrors the research workspace's own look —
 * parchment, Newsreader serif, stone ink with warm accents — and presents the
 * product's features as small interactive mockups rather than screenshots.
 */
export const LandingPage: FC = () => {
  const goToApp = useGoToApp();
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-parchment font-serif text-stone-800">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-parchment/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="flex items-center gap-2 text-[19px] font-semibold tracking-tight text-stone-900">
            <BrandMark className="text-[22px] text-orange-500" />
            Talleyrand
          </span>
          <div className="flex items-center gap-5">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[15px] font-medium text-stone-500 transition-colors hover:text-stone-900"
            >
              <GitHubIcon className="icon-optical h-[18px] w-[18px]" />
              GitHub
            </a>
            <button onClick={goToApp} className={PILL_BTN}>
              {isAuthenticated ? 'Open workspace' : 'Sign in'}
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-8 pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pt-24">
        <div>
          <Eyebrow>An AI workspace for research &amp; thinking</Eyebrow>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-tight text-stone-900 sm:text-6xl">
            Ask <span className="italic text-orange-600">better</span> questions
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-600">
            Research means dozens of open questions, and it's easy to lose the thread. Talleyrand
            keeps them in one tree, always shows you the next question worth asking. The longer you
            work, the better it understands&nbsp;you.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <button onClick={goToApp} className={`${PILL_BTN} px-7 py-3.5 text-[17px]`}>
              Open a case
            </button>
            <a
              href="#features"
              className="text-[15px] font-medium text-stone-500 underline decoration-stone-300 underline-offset-4 transition-colors hover:text-stone-800"
            >
              See how it works
            </a>
          </div>
          <p className="mt-5 text-[13px] text-stone-400">
            It's all free and{' '}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-600"
            >
              open-source
            </a>
            , but you need your own OpenAI key (Anthropic optional, for Claude answers).
          </p>
        </div>

        {/* A faithful, static snapshot of the two-pane workspace */}
        <HeroWindow />
      </section>

      {/* Interactive feature demos */}
      <section id="features" className="mx-auto max-w-3xl px-6 pb-8 pt-20">
        <div className="text-center">
          <Eyebrow center>See it in action</Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">
            Research in four moves
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-stone-500">
            Talking to LLMs is great for deep topics, but linear chat isn't the best UI. It grows,
            and you end up scrolling back and forth. In Talleyrand every question stays in a
            subtree, the AI reads all of it, and every reaction you give teaches it what you want.
          </p>
        </div>

        <div className="mt-16 space-y-24">
          <KickstartDemo />
          <BranchDemo />
          <FrontierDemo />
          <SuggestionsDemo />
        </div>
      </section>

      {/* Secondary feature grid */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="text-center">
          <Eyebrow center>And the rest of the desk</Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">
            Everything the deep dive needs, in one place
          </h2>
        </div>
        <FeatureGrid />
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="overflow-hidden rounded-3xl bg-stone-900 px-8 py-16 text-center shadow-[0_20px_60px_rgba(28,25,23,0.25)]">
          <BrandMark className="block text-4xl text-orange-400" />
          <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-semibold leading-tight text-stone-50 sm:text-4xl">
            Stop losing your train of thought in a scroll of chat.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-stone-400">
            Give a messy question room to branch. Talleyrand keeps the structure so you can keep
            thinking.
          </p>
          <button
            onClick={goToApp}
            className="mt-9 rounded-full bg-orange-500 px-8 py-3.5 text-[17px] font-medium text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-orange-400 hover:shadow-xl"
          >
            {isAuthenticated ? 'Open your workspace' : 'Start free with your own key'}
          </button>
        </div>
      </section>

      {/* Footer */}
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
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-1.5 transition-colors hover:text-stone-600"
        >
          <GitHubIcon className="icon-optical h-4 w-4" />
          Source on GitHub
        </a>
        <div className="mt-3 flex items-center justify-center gap-4">
          <Link to="/privacy" className={FOOTER_LINK}>
            Privacy
          </Link>
          <Link to="/terms" className={FOOTER_LINK}>
            Terms
          </Link>
          {isAnalyticsConfigured() && (
            // Withdrawing has to be as easy as accepting was, and a visitor who
            // never signs in cannot reach the setting inside the app.
            <button type="button" onClick={resetConsent} className={FOOTER_LINK}>
              Cookies
            </button>
          )}
        </div>
      </footer>
    </div>
  );
};

/* ─────────────────────────── shared helpers ─────────────────────────── */

// Real shared cases seeded by the backend (features/demo_cases); each demo
// links to the one that continues it, so visitors can browse and copy it.
const DEMO_CASE_ROUTES = {
  computeGovernance: '/shared/demo-compute-governance',
  moralProgress: '/shared/demo-moral-progress',
  bigFive: '/shared/demo-big-five',
  freeWill: '/shared/demo-free-will',
} as const;

const FOOTER_LINK =
  'underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-600';

// The workspace's primary action: an ink pill that lifts on hover.
const PILL_BTN =
  'rounded-full bg-stone-900 px-5 py-2 text-[15px] font-medium text-stone-50 shadow-[0_4px_20px_rgba(28,25,23,0.2)] transition-all hover:-translate-y-0.5 hover:bg-stone-700 hover:shadow-[0_10px_30px_rgba(28,25,23,0.28)]';

/** Route into the app, sending signed-out visitors through login first. */
function useGoToApp(): () => void {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  return useCallback(
    () => navigate(isAuthenticated ? '/research' : '/login'),
    [navigate, isAuthenticated]
  );
}

const Eyebrow: FC<{ children: ReactNode; center?: boolean }> = ({ children, center }) => (
  <span
    className={`inline-flex items-center gap-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400 ${
      center ? 'justify-center' : ''
    }`}
  >
    <span className="h-px w-5 bg-stone-300" />
    {children}
  </span>
);

const SparkIcon: FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path d="M9.66 3.5l1.15 2.84 2.84 1.15-2.84 1.15-1.15 2.85-1.15-2.85-2.85-1.15 2.85-1.15L9.66 3.5zM17.5 11l.9 2.23 2.23.9-2.23.9-.9 2.22-.9-2.22-2.22-.9 2.22-.9.9-2.23zM8 15.5l.77 1.9 1.9.77-1.9.77-.77 1.9-.77-1.9-1.9-.77 1.9-.77.77-1.9z" />
  </svg>
);

const GitHubIcon: FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 16 16" aria-hidden>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

const PinIcon: FC<{ className?: string }> = ({ className = 'h-3 w-3' }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 17v5M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1z"
    />
  </svg>
);

const BulbIcon: FC<{ className?: string }> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.5.38.8.96.85 1.58l.05.62h5.4l.05-.62c.05-.62.35-1.2.85-1.58A6 6 0 0012 3z"
    />
  </svg>
);

const HeartIcon: FC<{ className?: string; filled?: boolean }> = ({
  className = 'h-4 w-4',
  filled,
}) => (
  <svg
    className={className}
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
    />
  </svg>
);

const CheckIcon: FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const XIcon: FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

type QState = 'open' | 'ready' | 'read' | 'resolved';

/** The frontier's lifecycle glyph — same shapes the workspace uses. */
const StateGlyph: FC<{ state: QState }> = ({ state }) => {
  switch (state) {
    case 'ready':
      return (
        <svg className="h-3.5 w-3.5 text-orange-600" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="6" />
        </svg>
      );
    case 'read':
      return (
        <svg className="h-3.5 w-3.5 text-stone-400" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    case 'resolved':
      return (
        <svg
          className="h-3.5 w-3.5 text-stone-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    default:
      return (
        <svg
          className="h-3.5 w-3.5 text-stone-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
        >
          <circle cx="12" cy="12" r="8" strokeWidth={2} />
        </svg>
      );
  }
};

/** A cross-link chip (`[[1.2]]`) exactly as the model writes them into answers. */
const RefChip: FC<{ children: ReactNode; state?: QState }> = ({ children, state = 'read' }) => (
  <span className="inline-flex max-w-72 items-center gap-1 rounded-md border border-stone-300 bg-stone-100 px-1.5 align-bottom text-[0.85em] leading-snug text-stone-700">
    <span className="text-stone-400">↳</span>
    <StateGlyph state={state} />
    <span className="min-w-0 truncate">{children}</span>
  </span>
);

/* ───────────────────────────── hero window ───────────────────────────── */

const HeroWindow: FC = () => (
  <div className="overflow-hidden rounded-xl bg-paper shadow-[0_24px_70px_rgba(28,25,23,0.18)] ring-1 ring-stone-900/10">
    {/* Faux chrome */}
    <div className="flex items-center gap-2 border-b border-stone-200 bg-stone-100/70 px-4 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
      <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
      <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
      <span className="ml-3 font-sans text-[11px] text-stone-400">talleyrand · research</span>
    </div>

    <div className="grid h-[430px] grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)]">
      {/* Frontier */}
      <div className="flex flex-col border-r border-stone-200 bg-paper">
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-3 py-2.5">
          <span className="min-w-0 truncate text-[13px] font-medium text-stone-800">
            AI capabilities timelines
          </span>
          <span className="flex-shrink-0 font-sans text-[11px] text-stone-400">Report</span>
        </div>
        <div className="border-b border-stone-200 px-3 py-2">
          <div className="font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            Brief
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-stone-500">
            Forecast AI capabilities through 2030 to work out which policies governments should
            adopt.
          </p>
        </div>
        <div className="flex-1 space-y-0.5 overflow-hidden px-2 py-2">
          <MockRow depth={0} state="read" label="When could AI automate AI research?" />
          <MockRow depth={1} state="ready" cursor label="How to measure R&D automation?" />
          <MockRow depth={2} state="open" label="Why does AI feel faster than it is?" />
          <MockRow depth={2} state="open" label="Will the 7-month doubling hold?" />
          <MockRow depth={1} state="open" label="Why do agents fail at long tasks?" />
          <MockRow depth={1} state="open" dot label="How binding are compute limits?" />
          <MockRow depth={1} state="resolved" label="What did past forecasts get wrong?" />
        </div>
      </div>

      {/* Thread */}
      <div className="flex flex-col bg-parchment">
        <div className="flex items-center gap-1 border-b border-stone-200 bg-paper px-3 py-2 font-sans text-[11px] text-stone-400">
          <span className="flex-shrink-0 text-stone-300">‹ ›</span>
          <span className="mx-1 h-3 w-px flex-shrink-0 bg-stone-200" />
          <span className="min-w-0 truncate">Automating research</span>
          <span className="flex-shrink-0 text-stone-300">›</span>
          <span className="min-w-0 truncate font-medium text-stone-600">Measurement</span>
        </div>
        <div className="flex-1 space-y-3 overflow-hidden px-4 py-3">
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 px-3.5 py-2 text-[12.5px] leading-snug text-stone-50">
              How would we actually measure AI R&D automation?
            </div>
          </div>
          <p className="text-[13px] leading-relaxed text-stone-700">
            Not by asking people: in the only randomized trial so far, developers using AI felt 20%
            faster but measured 19% slower. The longest task AI can finish alone has{' '}
            <span className="marker-child-selection">doubled every four months</span>. Before
            extrapolating, see <RefChip state="open">Why do agents fail at long tasks?</RefChip>
          </p>
          <div>
            <div className="mb-1.5 flex items-center gap-1 font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-stone-400">
              <SparkIcon className="h-2.5 w-2.5" />
              Suggested questions
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-violet-300 bg-violet-50/70 px-2.5 py-1.5">
              <span className="min-w-0 flex-1 text-[12px] leading-snug text-stone-700">
                If AI were already speeding up research inside labs, what would we see from outside?
              </span>
              <span className="flex flex-shrink-0 items-center gap-1.5 text-stone-400">
                <CheckIcon className="h-3.5 w-3.5" />
                <XIcon className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </div>
        <div className="border-t border-stone-200 bg-paper px-3 py-2.5">
          <div className="rounded-2xl border border-stone-300 bg-white px-3 py-2 text-[12px] text-stone-400">
            Ask a follow-up question…
          </div>
        </div>
      </div>
    </div>
  </div>
);

const MockRow: FC<{
  depth: number;
  state: QState;
  label: string;
  cursor?: boolean;
  dot?: boolean;
}> = ({ depth, state, label, cursor, dot }) => (
  <div
    className={`relative flex items-center gap-1.5 rounded-lg py-1.5 pr-2 ${
      cursor ? 'bg-stone-900' : ''
    }`}
    style={{ paddingLeft: `${8 + depth * 14}px` }}
  >
    {Array.from({ length: depth }).map((_, i) => (
      <span
        key={i}
        className={`pointer-events-none absolute top-0 bottom-0 w-px ${
          cursor ? 'bg-stone-700' : 'bg-stone-300'
        }`}
        style={{ left: `${15 + i * 14}px` }}
      />
    ))}
    <StateGlyph state={state} />
    <span
      className={`min-w-0 flex-1 truncate text-[12px] ${
        cursor ? 'font-medium text-stone-50' : 'text-stone-700'
      }`}
    >
      {label}
    </span>
    {dot && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-500" />}
  </div>
);

/* ─── Demo scaffold: caption + framed stage ─── */

const Demo: FC<{
  n: number;
  title: string;
  blurb: ReactNode;
  caseHref?: string;
  children: ReactNode;
}> = ({ n, title, blurb, caseHref, children }) => (
  <div>
    <div className="mb-4 flex items-baseline gap-3">
      <span className="font-sans text-[13px] font-semibold tabular-nums text-orange-500">
        {String(n).padStart(2, '0')}
      </span>
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-stone-900">{title}</h3>
        <p className="mt-1 text-[14.5px] leading-relaxed text-stone-500">{blurb}</p>
      </div>
    </div>
    <div className="rounded-2xl border border-stone-200 bg-paper p-4 shadow-[0_2px_16px_rgba(28,25,23,0.05)] sm:p-6">
      {children}
    </div>
    {caseHref && (
      <div className="mt-3 text-right">
        <Link
          to={caseHref}
          target="_blank"
          rel="noopener noreferrer"
          data-tooltip="A real shared case — browse it, then copy it to continue yourself"
          className="font-sans text-[13px] font-medium text-stone-500 transition-colors hover:text-orange-700"
        >
          Open this case →
        </Link>
      </div>
    )}
  </div>
);

/* ───────────────────────── Demo 1: Kickstart ───────────────────────── */

const KICKSTART_NOTE = `I'm a policy analyst. I know export controls and the EU AI Act well. But I can't tell whether compute governance actually slows dangerous AI capabilities or just moves them elsewhere. Some people I trust say one thing, some say the opposite. I want to know which is true.`;

const KICKSTART_BRIEF =
  'Work out whether compute governance slows the development of dangerous AI capabilities or mostly relocates it. Main threads: what the controls restrict in practice, evasion and smuggling, domestic substitutes, and what success would even look like.';

const KICKSTART_QUESTIONS = [
  'What does compute governance actually restrict today, in practice?',
  'How much have export controls slowed frontier training runs so far?',
  'How easily can controlled chips be smuggled or substituted?',
  'What is the track record of past technology controls, like nuclear or crypto?',
  'What evidence would show the controls work — or just relocate the work?',
];

const KickstartDemo: FC = () => {
  const [note, setNote] = useState(KICKSTART_NOTE);
  const [phase, setPhase] = useState<'idle' | 'drafting' | 'done'>('idle');

  // A staged delay to mimic the model drafting — this is deliberate demo
  // choreography, not a workaround for timing.
  useEffect(() => {
    if (phase !== 'drafting') return;
    const timer = window.setTimeout(() => setPhase('done'), 1100);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <Demo
      n={1}
      title="Start from a mess, not a blank page"
      blurb="This is how you kickstart the research. Type or dictate a stream of thoughts — what you already know, what you want to know, notes, doubts, half-baked thoughts. Talleyrand turns the mess into a short brief and your first questions."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            Your brain-dump
          </div>
          <textarea
            value={note}
            onChange={e => {
              setNote(e.target.value);
              setPhase('idle');
            }}
            rows={6}
            className="w-full resize-none rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-[14px] leading-relaxed text-stone-700 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none"
          />
          <button
            onClick={() => setPhase('drafting')}
            disabled={phase === 'drafting' || !note.trim()}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-stone-900 py-2.5 pl-4 pr-5 text-[14px] font-medium text-stone-50 transition-all hover:-translate-y-0.5 hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:hover:translate-y-0"
          >
            <SparkIcon className="icon-optical h-4 w-4 text-orange-400" />
            {phase === 'drafting' ? 'Drafting…' : 'Draft brief & questions'}
          </button>
        </div>

        <div className="rounded-xl border border-stone-200 bg-parchment/60 p-3.5">
          {phase === 'idle' && (
            <div className="flex h-full min-h-[190px] items-center justify-center px-6 text-center text-[13px] leading-relaxed text-stone-400">
              Your brief and starting questions will appear here.
            </div>
          )}
          {phase === 'drafting' && (
            <div className="space-y-2.5">
              <div className="kickstart-skeleton h-3 w-1/3 rounded" />
              <div className="kickstart-skeleton h-3 w-full rounded" />
              <div className="kickstart-skeleton h-3 w-11/12 rounded" />
              <div className="kickstart-skeleton h-3 w-4/5 rounded" />
              <div className="mt-4 space-y-2">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="kickstart-skeleton h-6 w-full rounded-lg" />
                ))}
              </div>
            </div>
          )}
          {phase === 'done' && (
            <div>
              <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
                Brief
              </div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-stone-700">{KICKSTART_BRIEF}</p>
              <p className="mt-1.5 flex items-center gap-1.5 font-sans text-[11.5px] text-stone-400">
                <PinIcon className="h-3 w-3 text-orange-500/80" />
                Pinned — the AI always sees this brief.
              </p>
              <div className="mt-4 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
                Starting questions
              </div>
              <div className="mt-2 space-y-1.5">
                {KICKSTART_QUESTIONS.map((q, i) => (
                  <div
                    key={q}
                    className="kickstart-row-enter flex items-start gap-2 rounded-lg border border-stone-200 bg-paper px-3 py-2 text-[13px] leading-snug text-stone-700"
                    style={{ animationDelay: `${i * 90}ms` }}
                  >
                    <span className="mt-0.5 flex-shrink-0">
                      <StateGlyph state="open" />
                    </span>
                    {q}
                  </div>
                ))}
              </div>
              <Link
                to={DEMO_CASE_ROUTES.computeGovernance}
                target="_blank"
                rel="noopener noreferrer"
                data-tooltip="The real case this drafts — browse it, then copy it to continue yourself"
                className="mt-4 inline-block text-[13px] font-medium text-orange-600 underline decoration-orange-300 underline-offset-4 transition-colors hover:text-orange-700"
              >
                Open this case →
              </Link>
            </div>
          )}
        </div>
      </div>
    </Demo>
  );
};

/* ─────────────────────── Demo 2: Branch from text ─────────────────────── */

interface BranchFollowUp {
  question: string;
  answer: ReactNode;
}

const BRANCH_FOLLOW_UPS: BranchFollowUp[] = [
  {
    question: 'How would we tell better reasoning apart from the winners writing history?',
    answer: (
      <>
        One test: whether a change cost its &ldquo;winners&rdquo; anything. That&apos;s exactly the
        fact you flagged — Britain enforced abolition for decades at real cost{' '}
        <RefChip>Did abolition happen for moral reasons or economic ones?</RefChip> — and
        self-congratulating history rarely sends the victors a bill. Follow the sacrifices.
      </>
    ),
  },
  {
    question: 'Are there moral changes that later reversed?',
    answer: (
      <>
        Plenty. Eugenics spent decades as the progressive, scientific position before it collapsed.
        Religious tolerance narrowed for centuries before it widened again — an earlier thread here
        tracked that one <RefChip state="resolved">Do moral circles only ever expand?</RefChip> — so
        moral change is no ratchet. But that rules out inevitability, not progress: gains are kept
        by defending them, never owed to us.
      </>
    ),
  },
];

const BranchDemo: FC = () => {
  const [showPopup, setShowPopup] = useState(false);
  const [value, setValue] = useState('');
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [thread, setThread] = useState<BranchFollowUp | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [insight, setInsight] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'reading' | 'done'>('idle');
  const answerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Staged demo choreography, like the kickstart demo — long enough to read
  // the "reading your whole case" line before the answer lands.
  useEffect(() => {
    if (phase !== 'reading') return;
    const timer = window.setTimeout(() => setPhase('done'), 1600);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // The demo has no model behind it, so a typed question is swapped for the
  // first canned follow-up — with a disclosure below the answer.
  const ask = (followUp: BranchFollowUp, swappedInput = false) => {
    window.getSelection()?.removeAllRanges();
    setShowPopup(false);
    setValue('');
    setThread(followUp);
    setSwapped(swappedInput);
    setPhase('reading');
  };

  // The popup's other action, working here like in the app: the phrase gets
  // the insight marker instead of spawning a follow-up.
  const toggleInsight = () => {
    window.getSelection()?.removeAllRanges();
    setShowPopup(false);
    setValue('');
    setInsight(v => !v);
  };

  // Open the popup when the user's selection touches the marked phrase.
  useEffect(() => {
    const el = answerRef.current;
    if (!el) return;
    const handleMouseUp = () => {
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        const mark = el.querySelector('mark');
        if (!el.contains(range.commonAncestorContainer)) return;
        if (!mark || !range.intersectsNode(mark)) return;
        const rect = range.getBoundingClientRect();
        setPos({ x: rect.left + rect.width / 2, y: rect.bottom + window.scrollY });
        setShowPopup(true);
        textareaRef.current?.focus();
      });
    };
    el.addEventListener('mouseup', handleMouseUp);
    return () => el.removeEventListener('mouseup', handleMouseUp);
  }, []);

  useEffect(() => {
    if (!showPopup) return;
    const handler = (e: MouseEvent) => {
      if (
        popupRef.current?.contains(e.target as Node) ||
        answerRef.current?.contains(e.target as Node)
      )
        return;
      setShowPopup(false);
      setValue('');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPopup]);

  return (
    <Demo
      n={2}
      title="Branch a follow-up from any sentence"
      blurb="See something worth digging into? Select it and ask. Every answer is written with the entire case in context: the brief, every thread, your highlights and reactions."
    >
      <div className="mx-auto max-w-xl">
        <div className="mb-3 flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 px-4 py-2.5 text-[14px] leading-snug text-stone-50">
            Is moral progress real, or just moral change?
          </div>
        </div>
        <div ref={answerRef} className="text-[15px] leading-relaxed text-stone-700">
          Abolition looks like progress from inside our own morality — but every era&apos;s morality
          approves of itself, so that alone proves little. The stronger case is that{' '}
          <mark
            className={insight ? 'marker-child-selection marker-insight' : 'marker-child-selection'}
          >
            some moral changes track better reasoning, not just changed tastes
          </mark>
          : wider evidence, fewer factual mistakes, more consistency. If so, progress is real but
          rarer than we&apos;d like.
        </div>

        {insight && (
          <p className="kickstart-row-enter mt-2 flex items-center gap-1.5 font-sans text-[12px] text-stone-400">
            <BulbIcon className="h-3.5 w-3.5 flex-shrink-0 text-yellow-600" />
            Flagged as an insight — later answers and suggestions will lean toward it.
          </p>
        )}

        {phase === 'idle' ? (
          <p className="mt-3 text-center font-sans text-[12px] text-stone-400">
            ↑ Select the <span className="marker-child-selection px-1">highlighted phrase</span> to
            branch
          </p>
        ) : (
          thread && (
            <div className="mt-4 border-l-2 border-stone-200 pl-3.5">
              <div className="mb-2.5 flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 px-3.5 py-2 text-[13px] leading-snug text-stone-50">
                  {thread.question}
                </div>
              </div>
              {phase === 'reading' ? (
                <div>
                  <div className="flex items-center gap-2 font-sans text-[12px] text-stone-400">
                    <span className="flex items-center gap-1">
                      <span className="thinking-dot" />
                      <span className="thinking-dot" />
                      <span className="thinking-dot" />
                    </span>
                    Reading your whole case…
                  </div>
                  <div className="mt-2.5 space-y-2">
                    <div className="kickstart-skeleton h-3 w-full rounded" />
                    <div className="kickstart-skeleton h-3 w-11/12 rounded" />
                    <div className="kickstart-skeleton h-3 w-3/5 rounded" />
                  </div>
                </div>
              ) : (
                <div>
                  <p className="kickstart-row-enter text-[13.5px] leading-relaxed text-stone-700">
                    {thread.answer}
                  </p>
                  <p className="mt-2.5 font-sans text-[12px] leading-relaxed text-stone-400">
                    The brief, attached docs, earlier threads, your highlights, and your interaction
                    history were already in the AI&apos;s view when it wrote this answer.
                  </p>
                  {swapped && (
                    <p className="mt-1.5 font-sans text-[12px] italic leading-relaxed text-stone-400">
                      One honest note: this demo is precomputed, so we swapped your question for
                      this one. The real app answers exactly what you ask.
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-4">
                    <button
                      onClick={() => {
                        setThread(null);
                        setSwapped(false);
                        setInsight(false);
                        setPhase('idle');
                      }}
                      className="font-sans text-[12px] font-medium text-stone-400 transition-colors hover:text-stone-700"
                    >
                      ↻ Run it again
                    </button>
                    <Link
                      to={DEMO_CASE_ROUTES.moralProgress}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-tooltip="The real case behind this demo — browse it, then copy it to continue yourself"
                      className="font-sans text-[12px] font-medium text-orange-600 underline decoration-orange-300 underline-offset-4 transition-colors hover:text-orange-700"
                    >
                      Open this case →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>

      {showPopup &&
        createPortal(
          <div ref={popupRef}>
            {/* Selection popup — matches the workspace's SelectionPopup */}
            <div
              className="absolute z-[9999] flex min-w-[380px] items-start gap-1 rounded-xl border border-stone-200 bg-white p-1 pr-3 shadow-2xl"
              style={{ left: pos.x, top: pos.y + 10, transform: 'translateX(-50%)' }}
            >
              <div
                className="absolute h-0 w-0 border-b-[8px] border-l-[8px] border-r-[8px] border-b-stone-200 border-l-transparent border-r-transparent"
                style={{ left: '50%', top: '-8px', transform: 'translateX(-50%)' }}
              />
              <textarea
                ref={textareaRef}
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    ask(BRANCH_FOLLOW_UPS[0], value.trim().length > 0);
                  } else if (e.key === 'Escape') {
                    setShowPopup(false);
                    setValue('');
                  }
                }}
                placeholder="Ask about the selected text…"
                rows={1}
                className="min-w-[200px] flex-1 resize-none bg-transparent px-2 py-1 text-[13px] leading-normal focus:outline-none"
              />
              <div className="flex gap-1 self-start pt-1">
                <button
                  onClick={toggleInsight}
                  {...iconTooltip(
                    insight ? 'Insight flagged — click to remove' : 'Mark as insight'
                  )}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-yellow-100 text-yellow-700 transition-colors hover:bg-yellow-200"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.5.38.8.96.85 1.58l.05.62h5.4l.05-.62c.05-.62.35-1.2.85-1.58A6 6 0 0012 3z"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => ask(BRANCH_FOLLOW_UPS[0], value.trim().length > 0)}
                  {...iconTooltip('Ask about selection')}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-amber-500 text-white transition-colors hover:bg-amber-600"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 5l7 7-7 7M5 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </div>
            </div>
            {/* Suggestion dropdown */}
            <div
              className="absolute z-[10000] min-w-[320px] max-w-[360px] overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl"
              style={{ left: pos.x, top: pos.y + 58, transform: 'translateX(-50%)' }}
            >
              <div className="border-b border-stone-100 bg-stone-50 px-2.5 py-1 font-sans text-[10px] text-stone-500">
                Suggested follow-ups
              </div>
              {BRANCH_FOLLOW_UPS.map(f => (
                <button
                  key={f.question}
                  onClick={() => ask(f)}
                  className="block w-full px-3 py-2 text-left text-[13px] leading-snug text-stone-700 transition-colors hover:bg-orange-50 hover:text-orange-800"
                >
                  {f.question}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </Demo>
  );
};

/* ─────────────────────── Demo 3: The Frontier tree ─────────────────────── */

interface FrontierNode {
  id: string;
  depth: number;
  state: QState;
  query: string;
  answer: ReactNode | null;
}

const FRONTIER_NODES: FrontierNode[] = [
  {
    id: 'root',
    depth: 0,
    state: 'read',
    query: 'What do Big Five traits actually predict?',
    answer: (
      <>
        Real outcomes, but modestly: conscientiousness predicts job and school performance,
        neuroticism predicts relationship strain. Almost nothing crosses r = .3.
      </>
    ),
  },
  {
    id: 'effect-size',
    depth: 1,
    state: 'ready',
    query: 'Is a correlation of .3 big or small?',
    answer: (
      <>
        Both. It explains &ldquo;only 9% of variance&rdquo;, yet it doubles some real-world odds.
        And it beats almost every other predictor psychology has.
      </>
    ),
  },
  {
    id: 'replication',
    depth: 2,
    state: 'open',
    query: 'Why do effect sizes shrink on replication?',
    answer: null,
  },
  {
    id: 'stability',
    depth: 1,
    state: 'open',
    query: 'Do traits change over a lifetime?',
    answer: null,
  },
  {
    id: 'mbti',
    depth: 1,
    state: 'resolved',
    query: 'Is Myers-Briggs any better?',
    answer: (
      <>
        No. Its types don&apos;t replicate — half of retakers get a different letter within weeks —
        while continuous traits stay stable. Settled, not worth more time.
      </>
    ),
  },
];

const FrontierDemo: FC = () => {
  const [cursor, setCursor] = useState('root');
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const active = FRONTIER_NODES.find(n => n.id === cursor) ?? FRONTIER_NODES[0];

  const select = (node: FrontierNode) => {
    setCursor(node.id);
    if (node.state === 'ready' && !readIds.has(node.id)) {
      setReadIds(prev => new Set(prev).add(node.id));
    }
  };

  return (
    <Demo
      n={3}
      title="A question tree that tracks what you've answered"
      blurb="Your whole case lives in one tree of questions. And it's not just for you: Talleyrand knows what you've read, what's waiting, and what's settled, and takes that into account."
      caseHref={DEMO_CASE_ROUTES.bigFive}
    >
      <div className="grid overflow-hidden rounded-xl border border-stone-200 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* Tree */}
        <div className="bg-paper py-2 md:border-r md:border-stone-200">
          {FRONTIER_NODES.map(node => {
            const isCursor = node.id === cursor;
            return (
              <button
                key={node.id}
                onClick={() => select(node)}
                className={`relative flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left transition-colors ${
                  isCursor ? 'bg-stone-900' : 'hover:bg-stone-200/60'
                }`}
                style={{ paddingLeft: `${10 + node.depth * 16}px` }}
              >
                {Array.from({ length: node.depth }).map((_, i) => (
                  <span
                    key={i}
                    className={`pointer-events-none absolute top-0 bottom-0 w-px ${
                      isCursor ? 'bg-stone-700' : 'bg-stone-300'
                    }`}
                    style={{ left: `${17 + i * 16}px` }}
                  />
                ))}
                <StateGlyph state={readIds.has(node.id) ? 'read' : node.state} />
                <span
                  className={`min-w-0 flex-1 truncate text-[13px] ${
                    isCursor ? 'font-medium text-stone-50' : 'text-stone-700'
                  }`}
                >
                  {node.query}
                </span>
              </button>
            );
          })}
        </div>

        {/* Thread for the selected node */}
        <div className="bg-parchment p-4">
          <div className="mb-3 flex justify-end">
            <div className="max-w-[90%] rounded-2xl rounded-br-md bg-stone-900 px-3.5 py-2 text-[13px] leading-snug text-stone-50">
              {active.query}
            </div>
          </div>
          {active.answer ? (
            <>
              <p className="text-[14px] leading-relaxed text-stone-700">{active.answer}</p>
              {readIds.has(active.id) && (
                <p className="kickstart-row-enter mt-3 flex items-center gap-1.5 font-sans text-[12px] text-stone-400">
                  <StateGlyph state="read" />
                  Marked as read — Talleyrand knows too.
                </p>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-stone-300 bg-stone-100/60 p-4 text-center">
              <div className="mb-2 text-[13px] text-stone-400">
                Still open — no answer written yet.
              </div>
              <Link
                to={DEMO_CASE_ROUTES.bigFive}
                target="_blank"
                rel="noopener noreferrer"
                data-tooltip="Copy the real case to ask it yourself"
                className="inline-block rounded-md bg-stone-900 px-3 py-1.5 text-[12px] font-medium text-stone-50 transition-colors hover:bg-stone-700"
              >
                Ask it yourself →
              </Link>
            </div>
          )}
        </div>
      </div>
    </Demo>
  );
};

/* ─────────────────── Demo 4: Suggested next questions ─────────────────── */

interface Suggestion {
  id: string;
  text: string;
  bigPicture?: boolean;
  acceptNote: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    id: 's1',
    text: 'What do compatibilists actually mean by a “free” choice?',
    acceptNote: 'Definitions matter here — more conceptual ground.',
  },
  {
    id: 's2',
    text: 'Do the Libet experiments really show decisions happen before awareness?',
    acceptNote: 'Experiments are the lane — bring data.',
  },
  {
    id: 's3',
    bigPicture: true,
    text: 'Am I asking an empirical question dressed up as a philosophical one?',
    acceptNote: 'Open to reframing — bolder questions welcome.',
  },
];

// The chips themselves come from the workspace's real decline reasons; each
// one teaches the demo a note for the "read on you" panel.
const DECLINE_NOTES: Record<DeclineReason, string> = {
  know_this: 'Knows the basics — skip the groundwork.',
  too_basic: 'Wants cruxes, not warm-ups.',
  off_topic: 'Stay closer to the main thread.',
  unclear: 'Phrase questions more plainly.',
};

type CardStatus = 'open' | 'accepted' | 'declined' | 'declinedQuietly';

interface ReadNote {
  id: string;
  kind: 'heart' | 'bulb' | 'accept' | 'decline';
  text: string;
}

const NOTE_ICONS: Record<ReadNote['kind'], ReactNode> = {
  heart: <HeartIcon filled className="h-3.5 w-3.5 text-rose-400" />,
  bulb: <BulbIcon className="h-3.5 w-3.5 text-yellow-600" />,
  accept: <CheckIcon className="h-3.5 w-3.5 text-emerald-600" />,
  decline: <XIcon className="h-3.5 w-3.5 text-stone-400" />,
};

/**
 * The workspace's suggestion-card toolbar: accept, then every decline reason as
 * its own one-click button, then a bare x for declining without one.
 */
const JudgeButtons: FC<{
  bigPicture?: boolean;
  onAccept: () => void;
  onDecline: (reason: DeclineReason) => void;
  onDismiss: () => void;
}> = ({ bigPicture, onAccept, onDecline, onDismiss }) => (
  <div className="flex flex-shrink-0 items-center gap-1">
    <button
      onClick={onAccept}
      {...iconTooltip('Accept')}
      className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-emerald-600"
    >
      <CheckIcon className="h-4 w-4" />
    </button>
    <span
      className={`mx-0.5 h-4 w-px flex-shrink-0 ${bigPicture ? 'bg-violet-200' : 'bg-stone-200'}`}
    />
    {DECLINE_REASONS.map(({ reason, title, Icon }) => (
      <button
        key={reason}
        onClick={() => onDecline(reason)}
        {...iconTooltip(`Decline — ${title}`)}
        className="rounded p-1 text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-rose-600"
      >
        <Icon className="h-4 w-4" />
      </button>
    ))}
    <button
      onClick={onDismiss}
      {...iconTooltip('Decline without a reason')}
      className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-rose-600"
    >
      <XIcon className="h-4 w-4" />
    </button>
  </div>
);

const AcceptedCard: FC = () => (
  <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[13.5px] text-emerald-800">
    <CheckIcon className="icon-optical h-4 w-4 flex-shrink-0" />
    Added to your question tree
  </div>
);

const SuggestionsDemo: FC = () => {
  const [statuses, setStatuses] = useState<Record<string, CardStatus>>({});
  const [notes, setNotes] = useState<ReadNote[]>([]);
  const [loved, setLoved] = useState(false);
  const [flagged, setFlagged] = useState(false);

  const set = (id: string, status: CardStatus) => setStatuses(prev => ({ ...prev, [id]: status }));

  const addNote = (note: ReadNote) =>
    setNotes(prev => (prev.some(n => n.text === note.text) ? prev : [...prev, note]));

  const removeNote = (id: string) => setNotes(prev => prev.filter(n => n.id !== id));

  const toggleLoved = () => {
    if (loved) removeNote('heart');
    else
      addNote({
        id: 'heart',
        kind: 'heart',
        text: 'This kind of answer lands — skeptical, evidence-first.',
      });
    setLoved(!loved);
  };

  const toggleFlagged = () => {
    if (flagged) removeNote('bulb');
    else
      addNote({
        id: 'bulb',
        kind: 'bulb',
        text: 'The brain-scan angle matters — keep it in view.',
      });
    setFlagged(!flagged);
  };

  const touched = loved || flagged || Object.keys(statuses).length > 0;

  const reset = () => {
    setStatuses({});
    setNotes([]);
    setLoved(false);
    setFlagged(false);
  };

  return (
    <Demo
      n={4}
      title="The AI proposes what's next and learns from your reactions"
      blurb="After each answer, Talleyrand proposes what to ask next, plus big-picture violet questions that challenge your framing. Accept them, or decline and say why. Every heart, highlight, and decline improves its understanding of your intent. The longer a case runs, the better it gets."
      caseHref={DEMO_CASE_ROUTES.freeWill}
    >
      <div className="mx-auto max-w-xl">
        <p className="mb-4 text-center font-sans text-[12px] text-stone-400">
          Try everything — heart the answer, flag the underlined phrase, accept or decline the
          questions.
        </p>

        <div className="flex items-end gap-2">
          <p className="min-w-0 flex-1 text-[15px] leading-relaxed text-stone-700">
            …so the argument leans on determinism itself;{' '}
            <button
              onClick={toggleFlagged}
              data-tooltip={flagged ? 'Insight flagged — click to remove' : 'Flag as an insight'}
              className={
                flagged
                  ? 'marker-insight marker-insight-removable text-left'
                  : 'cursor-pointer rounded-[3px] border-b border-dashed border-yellow-600/60 text-left transition-colors hover:bg-yellow-100/70'
              }
            >
              the brain-scan evidence adds less than it seems
            </button>
            .
          </p>
          <button
            onClick={toggleLoved}
            aria-pressed={loved}
            {...iconTooltip(
              loved
                ? 'Loved — marked as especially useful'
                : 'Mark this answer as especially useful'
            )}
            className={`flex-shrink-0 rounded p-0.5 transition-colors ${
              loved ? 'text-rose-400' : 'text-stone-300 hover:text-rose-300'
            }`}
          >
            <HeartIcon filled={loved} className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center gap-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            <SparkIcon className="h-3 w-3" />
            Suggested questions
          </div>
          <div className="flex flex-col gap-1.5">
            {SUGGESTIONS.map(s => {
              const status = statuses[s.id] ?? 'open';

              if (status === 'accepted') return <AcceptedCard key={s.id} />;

              if (status === 'declined' || status === 'declinedQuietly') {
                return (
                  <div
                    key={s.id}
                    className="rounded-xl border border-dashed border-stone-300 bg-stone-100/60 px-3 py-2 text-[13px] italic text-stone-400"
                  >
                    {status === 'declined' ? 'Declined — noted.' : 'Declined.'}
                  </div>
                );
              }

              return (
                <div
                  key={s.id}
                  className={`flex items-center gap-1 rounded-xl border px-3 py-2 transition-colors ${
                    s.bigPicture
                      ? 'border-violet-300 bg-violet-50/70 hover:border-violet-400'
                      : 'border-stone-200 bg-paper hover:border-stone-300'
                  }`}
                >
                  <span className="min-w-0 flex-1 pr-1 text-[13.5px] leading-snug text-stone-700">
                    {s.text}
                  </span>
                  <JudgeButtons
                    bigPicture={s.bigPicture}
                    onAccept={() => {
                      set(s.id, 'accepted');
                      addNote({ id: `accept-${s.id}`, kind: 'accept', text: s.acceptNote });
                    }}
                    onDecline={reason => {
                      set(s.id, 'declined');
                      addNote({
                        id: `decline-${s.id}`,
                        kind: 'decline',
                        text: DECLINE_NOTES[reason],
                      });
                    }}
                    onDismiss={() => set(s.id, 'declinedQuietly')}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-stone-200 bg-parchment/60 px-3.5 py-3">
          <div className="flex items-center gap-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            <SparkIcon className="h-3 w-3 text-orange-400" />
            Talleyrand&apos;s read on you
          </div>
          {notes.length === 0 ? (
            <p className="mt-1.5 text-[13px] italic text-stone-400">
              A new case — still learning what you&apos;re after.
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {notes.map(n => (
                <div
                  key={n.id}
                  className="kickstart-row-enter flex items-start gap-2 text-[13px] leading-snug text-stone-600"
                >
                  <span className="mt-0.5 flex-shrink-0">{NOTE_ICONS[n.kind]}</span>
                  {n.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {touched && (
          <button
            onClick={reset}
            className="mt-3 font-sans text-[12px] font-medium text-stone-400 transition-colors hover:text-stone-700"
          >
            ↻ Reset the demo
          </button>
        )}
      </div>
    </Demo>
  );
};

/* ─────────────────────────── Feature grid ─────────────────────────── */

const FEATURES: { title: string; body: string; icon: ReactNode; accent: string }[] = [
  {
    title: 'Insight highlights',
    body: 'Flag a passage with the lightbulb; those insights improve every later answer and suggestion.',
    accent: 'text-yellow-500',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.5.38.8.96.85 1.58l.05.62h5.4l.05-.62c.05-.62.35-1.2.85-1.58A6 6 0 0012 3z"
      />
    ),
  },
  {
    title: 'Cross-links',
    body: 'Answers reference other questions as live chips — click one to jump straight to that thread.',
    accent: 'text-stone-500',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m9.656-1.828a4 4 0 000-5.656l-.001-.001a4 4 0 00-5.656 0l-3 3a4 4 0 000 5.656"
      />
    ),
  },
  {
    title: 'Choose your model',
    body: 'Answer with the latest GPT or Claude models at any thinking level. Easily regenerate with another.',
    accent: 'text-stone-500',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
      />
    ),
  },
  {
    title: 'Attach documents',
    body: 'Give the case or a single question its own source material to reason over.',
    accent: 'text-stone-500',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
      />
    ),
  },
  {
    title: 'Love the best answers',
    body: 'Heart the answers that land. They become a strong signal for the report and later prompts.',
    accent: 'text-rose-400',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
      />
    ),
  },
  {
    title: 'One-click report',
    body: 'Turn the whole case into a clean Markdown write-up you can copy or download.',
    accent: 'text-stone-500',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    ),
  },
  {
    title: 'Share read-only',
    body: 'Publish a case as a link. Readers can follow the whole tree, and copy the case to continue the work themselves.',
    accent: 'text-stone-500',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
      />
    ),
  },
  {
    title: 'Dictate a question',
    body: "Think out loud — speak your question and it's transcribed straight into the composer.",
    accent: 'text-stone-500',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8M12 3a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3z"
      />
    ),
  },
  {
    title: 'Runs while you are away',
    body: 'Answers generate on the server, so closing the tab never loses in-flight work.',
    accent: 'text-stone-500',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    ),
  },
];

const FeatureGrid: FC = () => (
  <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
    {FEATURES.map(f => (
      <div
        key={f.title}
        className="rounded-2xl border border-stone-200 bg-paper p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(28,25,23,0.07)]"
      >
        <svg
          className={`h-6 w-6 ${f.accent}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          viewBox="0 0 24 24"
          aria-hidden
        >
          {f.icon}
        </svg>
        <h3 className="mt-3 text-[16px] font-semibold text-stone-800">{f.title}</h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-stone-500">{f.body}</p>
      </div>
    ))}
  </div>
);
