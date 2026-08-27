import { FC, memo, useMemo } from 'react';
import type { ResearchSuggestion } from '../../types';
import { useResearchStore } from '../../stores/researchStore';
import { DECLINE_REASONS } from './declineReasons';
import { iconTooltip } from '../ui/TooltipLayer';

/**
 * A single proposed question, shown as a card under the answer it follows.
 * Accept files it as a follow-up question; every decline reason is its own
 * button so turning a question down is always a single click, and the bare x
 * declines without giving one. Big-picture suggestions render with violet accents.
 */
const SuggestionCard: FC<{ suggestion: ResearchSuggestion }> = ({ suggestion }) => {
  const acceptSuggestion = useResearchStore(s => s.acceptSuggestion);
  const declineSuggestion = useResearchStore(s => s.declineSuggestion);
  const isBigPicture = suggestion.bigPicture;

  return (
    <div
      className={`flex items-center gap-1 rounded-xl border px-3 py-2 transition-colors ${
        isBigPicture
          ? 'border-violet-300 bg-violet-50/70 shadow-sm hover:border-violet-400'
          : 'border-stone-200 bg-paper hover:border-stone-300'
      }`}
    >
      <span
        className={`min-w-0 flex-1 pr-1 font-serif text-[13.5px] leading-snug ${
          isBigPicture ? 'text-stone-700' : 'text-stone-600'
        }`}
      >
        {suggestion.text}
      </span>
      <button
        onClick={() => acceptSuggestion(suggestion.id)}
        className="flex-shrink-0 rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-emerald-600"
        {...iconTooltip('Accept')}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </button>
      {/* Decline group: one click each, the reason comes along for free */}
      <span
        className={`mx-0.5 h-4 w-px flex-shrink-0 ${
          isBigPicture ? 'bg-violet-200' : 'bg-stone-200'
        }`}
      />
      {DECLINE_REASONS.map(({ reason, title, Icon }) => (
        <button
          key={reason}
          onClick={() => declineSuggestion(suggestion.id, reason)}
          /* stone-500 so these hairline glyphs read at the same weight as the
             heavy check and x strokes beside them */
          className="flex-shrink-0 rounded p-1 text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-rose-600"
          {...iconTooltip(`Decline — ${title}`)}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
      <button
        onClick={() => declineSuggestion(suggestion.id, null)}
        className="flex-shrink-0 rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-rose-600"
        {...iconTooltip('Decline without a reason')}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
};

/** Placeholder shown while a follow-up suggestion job for this answer is running. */
const GeneratingRow: FC = () => (
  <div className="flex items-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-100/40 px-3 py-2 text-stone-400">
    <svg className="h-3.5 w-3.5 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
    <span className="font-serif text-[12.5px] italic">Finding follow-up questions…</span>
  </div>
);

/**
 * The pending suggestions filed under one question, rendered as cards beneath
 * its answer (plus a placeholder while more are generating), followed by a
 * "Suggest more" button that requests another batch on demand — shown for
 * every completed answer, even one with no pending suggestions. Big-picture questions
 * sort first so the cross-cutting prompts sit on top. Memoized so the answer's
 * per-chunk re-renders never touch the cards.
 */
const AnswerSuggestionsComponent: FC<{ nodeId: string }> = ({ nodeId }) => {
  const suggestions = useResearchStore(s => s.suggestions);
  const isGenerating = useResearchStore(s =>
    Object.values(s.suggestionJobs).some(target => target === nodeId)
  );
  const requestMoreSuggestions = useResearchStore(s => s.requestMoreSuggestions);
  const mine = useMemo(
    () =>
      suggestions
        .filter(s => s.parentNodeId === nodeId)
        .sort((a, b) => Number(b.bigPicture) - Number(a.bigPicture)),
    [suggestions, nodeId]
  );

  const hasSuggestions = mine.length > 0;

  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-stone-400">
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.66 3.5l1.15 2.84 2.84 1.15-2.84 1.15-1.15 2.85-1.15-2.85-2.85-1.15 2.85-1.15L9.66 3.5zM17.5 11l.9 2.23 2.23.9-2.23.9-.9 2.22-.9-2.22-2.22-.9 2.22-.9.9-2.23zM8 15.5l.77 1.9 1.9.77-1.9.77-.77 1.9-.77-1.9-1.9-.77 1.9-.77.77-1.9z"
          />
        </svg>
        Suggested questions
      </div>
      <div className="flex flex-col gap-1.5">
        {mine.map(suggestion => (
          <SuggestionCard key={suggestion.id} suggestion={suggestion} />
        ))}
        {isGenerating && <GeneratingRow />}
      </div>
      <button
        type="button"
        onClick={() => requestMoreSuggestions(nodeId)}
        disabled={isGenerating}
        data-tooltip={
          hasSuggestions
            ? 'Generate more follow-up questions for this answer'
            : 'Generate follow-up questions for this answer'
        }
        className="mt-1.5 inline-flex items-center gap-1 rounded-md px-0.5 py-0.5 text-[11px] font-medium text-stone-400 transition-colors hover:text-stone-600 disabled:cursor-not-allowed disabled:text-stone-300"
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        {hasSuggestions ? 'Suggest more' : 'Suggest questions'}
      </button>
    </div>
  );
};

export const AnswerSuggestions = memo(AnswerSuggestionsComponent);
