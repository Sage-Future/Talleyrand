import { FC, memo } from 'react';
import { researchGenerationService } from '../../services/researchGenerationService';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { useResearchStore } from '../../stores/researchStore';
import { QuestionStateIcon, useQuestionState } from '../ui/QuestionStateIcon';
import { TreeGuides } from './TreeGuides';
import { iconTooltip } from '../ui/TooltipLayer';

interface FrontierRowProps {
  nodeId: string;
  depth: number;
  ancestors: string[];
}

const FrontierRowComponent: FC<FrontierRowProps> = ({ nodeId, depth, ancestors }) => {
  // Narrow per-node selectors with primitive/stable outputs (audit #10)
  const query = useNodeContentStore(s => s.nodeContents[nodeId]?.query ?? '');
  const resolved = useNodeContentStore(s => !!s.nodeContents[nodeId]?.resolvedAt);
  const isRead = useResearchStore(s => s.readHistory.some(event => event.nodeId === nodeId));
  const isCursor = useResearchStore(s => s.cursorNodeId === nodeId);
  const isRefHovered = useResearchStore(s => s.hoveredRefNodeId === nodeId);
  // Pending suggestions filed under this question, shown as cards in the thread.
  // The row carries a quiet count so the user knows how much is waiting inside
  // without it competing with the unread indicator at the start of the row.
  const suggestionCount = useResearchStore(
    s => s.suggestions.filter(sug => sug.parentNodeId === nodeId).length
  );
  const hasBigPictureSuggestion = useResearchStore(s =>
    s.suggestions.some(sug => sug.parentNodeId === nodeId && sug.bigPicture)
  );
  const state = useQuestionState(nodeId);

  const visitNode = useResearchStore(s => s.visitNode);
  const askQuestion = useResearchStore(s => s.askQuestion);
  const toggleResolved = useResearchStore(s => s.toggleResolved);
  const deleteQuestion = useResearchStore(s => s.deleteQuestion);
  const requestMoreSuggestions = useResearchStore(s => s.requestMoreSuggestions);

  const handleClick = () => {
    visitNode(nodeId);
    if (state === 'open') {
      askQuestion(nodeId);
    }
  };

  const countTone = hasBigPictureSuggestion
    ? isCursor
      ? 'text-violet-300'
      : 'text-violet-500'
    : 'text-stone-400';

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (window.confirm('Delete this question and all questions under it?')) {
      deleteQuestion(nodeId);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`group relative flex cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-2 my-px transition-colors ${
        isCursor ? 'bg-stone-900' : isRefHovered ? 'bg-orange-100/70' : 'hover:bg-stone-200/60'
      } ${isRefHovered ? 'ring-2 ring-inset ring-orange-300/80' : ''} ${
        state === 'resolved' ? 'opacity-50' : ''
      }`}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      data-testid="frontier-row"
    >
      <TreeGuides ancestors={ancestors} onInk={isCursor} />
      <span className="flex-shrink-0">
        <QuestionStateIcon state={state} />
      </span>
      <span
        className={`flex-1 min-w-0 truncate font-serif text-[13px] ${
          isCursor ? 'font-medium text-stone-50' : 'text-stone-700'
        }`}
        data-tooltip={query}
      >
        {query || '(empty question)'}
      </span>

      {/* How many suggested questions sit under this one. Violet when one of them
          is big-picture, since those are the rare ones worth noticing. Orange is
          reserved for the unread indicator at the start of the row. */}
      {suggestionCount > 0 && (
        <span
          className={`flex-shrink-0 text-[11px] tabular-nums ${countTone}`}
          data-tooltip={
            hasBigPictureSuggestion
              ? `${suggestionCount} suggested ${suggestionCount === 1 ? 'question' : 'questions'}, including a big-picture one`
              : `${suggestionCount} suggested ${suggestionCount === 1 ? 'question' : 'questions'}`
          }
        >
          {suggestionCount}
        </span>
      )}

      {/* Hover actions */}
      <span
        className={`absolute right-1 hidden items-center gap-0.5 rounded px-0.5 group-hover:flex ${
          isCursor ? 'bg-stone-900' : 'bg-stone-200'
        }`}
      >
        {/* In-flight or failed: let the user restart a generation that froze */}
        {(state === 'streaming' || state === 'queued' || state === 'error') && (
          <button
            onClick={event => {
              event.stopPropagation();
              researchGenerationService.retry(nodeId);
            }}
            className={`rounded p-0.5 hover:text-orange-500 ${
              isCursor ? 'text-stone-500' : 'text-stone-400'
            }`}
            {...iconTooltip('Retry — restart this question if it froze')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        )}
        {isRead && (
          <button
            onClick={event => {
              event.stopPropagation();
              requestMoreSuggestions(nodeId);
            }}
            className={`rounded p-0.5 hover:text-orange-500 ${
              isCursor ? 'text-stone-500' : 'text-stone-400'
            }`}
            {...iconTooltip('Suggest more questions here')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.66 3.5l1.15 2.84 2.84 1.15-2.84 1.15-1.15 2.85-1.15-2.85-2.85-1.15 2.85-1.15L9.66 3.5zM17.5 11l.9 2.23 2.23.9-2.23.9-.9 2.22-.9-2.22-2.22-.9 2.22-.9.9-2.23zM8 15.5l.77 1.9 1.9.77-1.9.77-.77 1.9-.77-1.9-1.9-.77 1.9-.77.77-1.9z"
              />
            </svg>
          </button>
        )}
        {isRead && (
          <button
            onClick={event => {
              event.stopPropagation();
              toggleResolved(nodeId);
            }}
            className={`rounded p-0.5 hover:text-emerald-500 ${
              isCursor ? 'text-stone-500' : 'text-stone-400'
            }`}
            {...iconTooltip(resolved ? 'Reopen' : 'Mark resolved')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </button>
        )}
        <button
          onClick={handleDelete}
          className={`rounded p-0.5 hover:text-rose-500 ${
            isCursor ? 'text-stone-500' : 'text-stone-400'
          }`}
          {...iconTooltip('Delete question')}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </span>
    </div>
  );
};

export const FrontierRow = memo(
  FrontierRowComponent,
  (prev, next) =>
    prev.nodeId === next.nodeId &&
    prev.depth === next.depth &&
    prev.ancestors.length === next.ancestors.length &&
    prev.ancestors.every((id, index) => next.ancestors[index] === id)
);
