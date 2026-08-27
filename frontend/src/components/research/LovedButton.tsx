import { FC } from 'react';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { useResearchStore } from '../../stores/researchStore';
import { iconTooltip } from '../ui/TooltipLayer';

/**
 * Subtle heart in the answer's bottom-right corner: marks the whole answer as
 * especially useful. A loved answer is flagged to the answerer, the suggesters,
 * and the report as a strong positive signal of what the user values. Just a
 * bare heart icon that fills when set — no button chrome.
 */
export const LovedButton: FC<{ nodeId: string }> = ({ nodeId }) => {
  const loved = useNodeContentStore(s => !!s.nodeContents[nodeId]?.lovedAt);
  const toggleLoved = useResearchStore(s => s.toggleLoved);

  return (
    <button
      onClick={() => toggleLoved(nodeId)}
      aria-pressed={loved}
      className={`rounded p-0.5 transition-colors ${
        loved ? 'text-rose-400' : 'text-stone-300 hover:text-rose-300'
      }`}
      {...iconTooltip(
        loved ? 'Loved — marked as especially useful' : 'Mark this answer as especially useful'
      )}
    >
      <svg
        className="h-3.5 w-3.5"
        fill={loved ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
        />
      </svg>
    </button>
  );
};
