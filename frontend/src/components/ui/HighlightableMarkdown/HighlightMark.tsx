/**
 * HighlightMark component - renders highlighted text with click interactions.
 */

import { useMemo, useCallback, useContext } from 'react';
import { useNodeContentStore } from '../../../stores/nodeContentStore';
import type { Annotation } from './types';
import { QuestionRefContext } from './QuestionRef';
import { InsightContext } from './InsightContext';

interface HighlightMarkProps {
  annotationIds: string | string[];
  annotationData: string | Annotation[];
  children: React.ReactNode;
}

export const HighlightMark: React.FC<HighlightMarkProps> = ({
  annotationIds,
  annotationData,
  children,
}) => {
  // Parse JSON strings if needed
  const parsedAnnotationIds = useMemo(() => {
    return typeof annotationIds === 'string' ? JSON.parse(annotationIds) : annotationIds;
  }, [annotationIds]);

  const parsedAnnotationData = useMemo(() => {
    return typeof annotationData === 'string' ? JSON.parse(annotationData) : annotationData;
  }, [annotationData]);

  // Filter out any undefined/null entries that might appear during state transitions
  const annotations: Annotation[] = parsedAnnotationData.filter(
    (ann: Annotation) => ann != null && ann.type != null
  );

  // Selection highlights double as reference chips: clicking one navigates to
  // the question that was asked about the selection. Same context as [[1.2]]
  // chips, so non-research surfaces (no provider) keep plain highlights.
  const openQuestionRef = useContext(QuestionRefContext);
  const childSelectionNodeId =
    annotations.find(ann => ann.marker === 'child-selection' && ann.childNodeId != null)
      ?.childNodeId ?? null;
  const childQuery = useNodeContentStore(s =>
    childSelectionNodeId ? (s.nodeContents[childSelectionNodeId]?.query ?? '') : ''
  );
  const isClickable = !!(openQuestionRef && childSelectionNodeId && childQuery);

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      // A drag that ends inside the highlight is a text selection
      // (select-to-ask), not a navigation click
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      event.stopPropagation();
      openQuestionRef?.(childSelectionNodeId!);
    },
    [openQuestionRef, childSelectionNodeId]
  );

  // Insight (lightbulb) highlights: clicking one removes it. Navigation on a
  // child-selection takes precedence when a passage is both.
  const removeInsight = useContext(InsightContext);
  const insightId =
    annotations.find(ann => ann.marker === 'insight' && ann.insightId)?.insightId ?? null;
  const isInsightRemovable = !!(removeInsight && insightId && !isClickable);

  const handleInsightClick = useCallback(
    (event: React.MouseEvent) => {
      // A drag ending inside is a text selection (re-ask / re-highlight), not a click
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      event.stopPropagation();
      removeInsight?.(insightId!);
    },
    [removeInsight, insightId]
  );

  const highlightClasses = [
    'highlight-mark',
    ...annotations.map(ann => `marker-${ann.marker}`),
    isClickable ? 'marker-child-selection-clickable' : '',
    isInsightRemovable ? 'marker-insight-removable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleMarkClick = isClickable
    ? handleClick
    : isInsightRemovable
      ? handleInsightClick
      : undefined;

  return (
    <mark
      className={highlightClasses}
      data-annotation-ids={parsedAnnotationIds.join(',')}
      data-tooltip={
        isClickable ? childQuery : isInsightRemovable ? 'Click to remove highlight' : undefined
      }
      onClick={handleMarkClick}
    >
      {children}
    </mark>
  );
};
