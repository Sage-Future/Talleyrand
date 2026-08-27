import { FC } from 'react';
import { useResearchStore } from '../../stores/researchStore';

interface TreeGuidesProps {
  ancestors: string[];
  /** Row carries the inverted ink background (the cursor chip) */
  onInk?: boolean;
  /** Vertical overshoot classes bridging the row's own margins */
  extend?: string;
}

/**
 * Indent guide lines for a frontier row: one hairline per ancestor level,
 * aligned under that ancestor's state icon. Consecutive descendant rows form
 * a continuous line from a parent through all its children. The line of the
 * cursor's own subtree is drawn darker, so the selected question's children
 * are obvious at a glance.
 */
export const TreeGuides: FC<TreeGuidesProps> = ({
  ancestors,
  onInk = false,
  extend = '-top-px -bottom-px',
}) => {
  const cursorLevel = useResearchStore(s =>
    s.cursorNodeId === null ? -1 : ancestors.indexOf(s.cursorNodeId)
  );

  return (
    <>
      {ancestors.map((_, level) => (
        <span
          key={level}
          aria-hidden
          className={`pointer-events-none absolute w-px ${extend} ${
            onInk ? 'bg-stone-700' : level === cursorLevel ? 'bg-stone-600' : 'bg-stone-300'
          }`}
          style={{ left: `${15 + level * 16}px` }}
        />
      ))}
    </>
  );
};
