import { FC, useState } from 'react';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { SelectableAnswer } from './SelectableAnswer';

interface AncestorItemProps {
  nodeId: string;
}

/**
 * A collapsed ancestor question in the thread: clicking anywhere on the row —
 * chevron or question text — expands its answer inline, like unfolding an older
 * message in a chat. The expanded answer is the same selectable component as
 * the current one, so the select-to-ask workflow branches from this ancestor.
 */
export const AncestorItem: FC<AncestorItemProps> = ({ nodeId }) => {
  const query = useNodeContentStore(s => s.nodeContents[nodeId]?.query ?? '');
  const hasResponse = useNodeContentStore(s => !!s.nodeContents[nodeId]?.response);
  const [expanded, setExpanded] = useState(false);

  const truncatedQuery = query.length > 500 ? `${query.slice(0, 500)}…` : query;

  return (
    <div className="border-b border-stone-200/70 py-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="group flex w-full items-start gap-1 text-left"
        data-tooltip={expanded ? 'Collapse answer' : 'Show answer'}
      >
        <span className="mt-1 flex-shrink-0 rounded p-0.5 text-stone-300 transition-colors group-hover:text-stone-500">
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </span>
        <span className="flex-1 min-w-0 font-serif text-[15px] font-medium text-stone-500 transition-colors group-hover:text-stone-900">
          {truncatedQuery}
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 mb-3">
          {hasResponse ? (
            <SelectableAnswer nodeId={nodeId} />
          ) : (
            <span className="text-xs text-stone-400">Not answered yet.</span>
          )}
        </div>
      )}
    </div>
  );
};
