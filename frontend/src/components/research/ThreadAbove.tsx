import { FC, useState } from 'react';
import { researchGenerationService } from '../../services/researchGenerationService';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { useResearchStore } from '../../stores/researchStore';
import { HighlightableMarkdown } from '../ui/HighlightableMarkdown';
import { QuestionRefContext } from '../ui/HighlightableMarkdown/QuestionRef';
import { AncestorItem } from './AncestorItem';
import { iconTooltip } from '../ui/TooltipLayer';

interface ThreadAboveProps {
  nodeId: string;
  ancestorIds: string[];
}

const CheatSheetIcon: FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    className={`icon-optical ${className}`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
    />
  </svg>
);

const RefreshIcon: FC<{ spinning: boolean }> = ({ spinning }) => (
  <svg
    className={`h-3.5 w-3.5 ${spinning ? 'animate-spin' : ''}`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

const AncestorList: FC<{ ancestorIds: string[] }> = ({ ancestorIds }) => (
  <>
    {ancestorIds.map(ancestorId => (
      <AncestorItem key={ancestorId} nodeId={ancestorId} />
    ))}
  </>
);

/**
 * The cheat sheet standing in for the collapsed thread: one folded row that
 * unfolds into the condensed thread above, with the real questions still one
 * click further down — the sheet is a refresher, not a replacement.
 */
const CheatSheet: FC<{ nodeId: string; ancestorIds: string[]; cheatSheet: string }> = ({
  nodeId,
  ancestorIds,
  cheatSheet,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showThread, setShowThread] = useState(false);
  const refreshing = useResearchStore(s => !!s.cheatSheetPending[nodeId]);
  const visitNode = useResearchStore(s => s.visitNode);

  const questionCount = ancestorIds.length;

  return (
    <div className="border-b border-stone-200/70 py-1.5">
      <div className="group flex items-start gap-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-start gap-1 text-left"
          data-tooltip={
            expanded ? 'Collapse the cheat sheet' : 'What the questions above established'
          }
        >
          <span className="mt-1 flex-shrink-0 rounded p-0.5 text-stone-300 transition-colors group-hover:text-stone-500">
            <svg
              className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </span>
          <CheatSheetIcon className="mt-[3px] h-3.5 w-3.5 flex-shrink-0 text-orange-400" />
          <span className="min-w-0 flex-1 font-serif text-[15px] font-medium text-stone-500 transition-colors group-hover:text-stone-900">
            Cheat sheet
            <span className="ml-1.5 text-[13px] font-normal text-stone-400">
              {refreshing
                ? '· refreshing…'
                : `· ${questionCount} question${questionCount === 1 ? '' : 's'} above`}
            </span>
          </span>
        </button>
        <button
          onClick={() => researchGenerationService.generateCheatSheet(nodeId)}
          disabled={refreshing}
          className="mt-0.5 flex-shrink-0 rounded p-1 text-stone-300 opacity-0 transition-all hover:bg-stone-200/60 hover:text-stone-600 focus:opacity-100 group-hover:opacity-100 disabled:opacity-100"
          {...iconTooltip('Rewrite it from the thread as it stands now')}
        >
          <RefreshIcon spinning={refreshing} />
        </button>
      </div>

      {expanded && (
        <div className="mb-3 mt-2">
          <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
            <div className="prose prose-sm max-w-none font-serif text-[14px] text-stone-700">
              <QuestionRefContext.Provider value={visitNode}>
                <HighlightableMarkdown content={cheatSheet} />
              </QuestionRefContext.Provider>
            </div>
          </div>
          <button
            onClick={() => setShowThread(!showThread)}
            className="mt-1.5 font-serif text-[12.5px] text-stone-400 transition-colors hover:text-stone-700"
          >
            {showThread ? 'Hide the full thread' : `Show the full thread (${questionCount})`}
          </button>
          {showThread && (
            <div className="mt-1">
              <AncestorList ancestorIds={ancestorIds} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** The offer to condense a thread that has no cheat sheet yet — questions
 *  answered before "summarize parents" was turned on. */
const SummarizeOffer: FC<{ nodeId: string }> = ({ nodeId }) => {
  const pending = useResearchStore(s => !!s.cheatSheetPending[nodeId]);

  return (
    <div className="flex justify-end pb-1 pt-0.5">
      <button
        onClick={() => researchGenerationService.generateCheatSheet(nodeId)}
        disabled={pending}
        className="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-serif text-[12.5px] text-stone-400 transition-colors hover:bg-stone-200/50 hover:text-stone-700 disabled:hover:bg-transparent disabled:hover:text-stone-400"
      >
        <CheatSheetIcon className="h-3.5 w-3.5" />
        {pending ? 'Writing the cheat sheet…' : 'Condense the thread above'}
      </button>
    </div>
  );
};

/**
 * Everything above the current question: either the collapsed ancestor
 * questions themselves, or — with "summarize parents" on — the cheat sheet
 * that condenses them.
 */
export const ThreadAbove: FC<ThreadAboveProps> = ({ nodeId, ancestorIds }) => {
  const summarizeParents = useResearchStore(s => s.summarizeParents);
  const cheatSheet = useNodeContentStore(s => s.nodeContents[nodeId]?.cheatSheet ?? '');
  // Answers are the material a sheet is made of: with none above, the server
  // refuses the job, so the offer would be a button that does nothing.
  const hasAnswerAbove = useNodeContentStore(s =>
    ancestorIds.some(ancestorId => !!s.nodeContents[ancestorId]?.response)
  );

  if (ancestorIds.length === 0 || !summarizeParents) {
    return <AncestorList ancestorIds={ancestorIds} />;
  }

  if (cheatSheet) {
    return <CheatSheet nodeId={nodeId} ancestorIds={ancestorIds} cheatSheet={cheatSheet} />;
  }

  return (
    <>
      {hasAnswerAbove && <SummarizeOffer nodeId={nodeId} />}
      <AncestorList ancestorIds={ancestorIds} />
    </>
  );
};
