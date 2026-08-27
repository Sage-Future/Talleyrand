/**
 * Utility to convert TextSelection objects to Annotation objects.
 */

import type { Highlight, TextSelection } from '../../../types';
import type { Annotation, MarkerKind, Block } from './types';

/**
 * Converts a TextSelection to a Annotation by mapping global offsets to block-relative offsets.
 */
export function selectionToAnnotation(
  selection: TextSelection,
  blocks: Block[],
  marker: MarkerKind,
  additionalProps?: Partial<Annotation>
): Annotation | null {
  if (selection.startOffset === undefined || selection.endOffset === undefined) {
    return null;
  }

  const result = findBlockForOffset(blocks, selection.startOffset, selection.endOffset);
  if (!result) {
    return null;
  }

  // Generate stable ID based on selection position and child node
  // Don't include marker type so the same selection keeps the same ID when marker changes
  const stableId = generateStableAnnotationId(
    result.blockId,
    result.relativeStart,
    result.relativeEnd,
    selection.childNodeId
  );

  return {
    id: stableId,
    blockId: result.blockId,
    start: result.relativeStart,
    end: result.relativeEnd,
    marker,
    type: marker, // Type matches marker for CSS class naming
    ...additionalProps,
    ...(selection.childNodeId && { childNodeId: selection.childNodeId }),
  };
}

/**
 * Converts multiple TextSelections to Annotations.
 */
export function selectionsToAnnotations(
  selections: TextSelection[],
  blocks: Block[],
  marker: MarkerKind,
  additionalProps?: Partial<Annotation>
): Annotation[] {
  return selections
    .map(sel => selectionToAnnotation(sel, blocks, marker, additionalProps))
    .filter((ann): ann is Annotation => ann !== null);
}

/**
 * Converts user highlights (insights) to 'insight' Annotations. Each
 * annotation carries the highlight's id so the rendered mark can remove it.
 */
export function highlightsToAnnotations(highlights: Highlight[], blocks: Block[]): Annotation[] {
  return highlights
    .map(highlight =>
      selectionToAnnotation(highlight, blocks, 'insight', { insightId: highlight.id })
    )
    .filter((ann): ann is Annotation => ann !== null);
}

/**
 * Finds which block contains the given global offset range and converts to block-relative offsets.
 */
function findBlockForOffset(
  blocks: Block[],
  globalStart: number,
  globalEnd: number
): { blockId: string; relativeStart: number; relativeEnd: number } | null {
  let cumulativeOffset = 0;

  for (const block of blocks) {
    const blockStart = cumulativeOffset;
    const blockEnd = cumulativeOffset + block.text.length;

    // Check if the selection falls within this block
    if (globalStart >= blockStart && globalStart < blockEnd) {
      // Selection starts in this block
      const relativeStart = globalStart - blockStart;
      const relativeEnd = Math.min(globalEnd - blockStart, block.text.length);

      // Handle selections that span multiple blocks by clamping to current block
      return {
        blockId: block.blockId,
        relativeStart,
        relativeEnd,
      };
    }

    // Move to next block, accounting for newline separator between blocks
    cumulativeOffset = blockEnd + 1;
  }

  return null;
}

/**
 * Generates a stable annotation ID based on position and context.
 * This ensures the same selection always gets the same ID, allowing React to
 * update DOM elements instead of removing and re-adding them when marker type changes.
 */
function generateStableAnnotationId(
  blockId: string,
  start: number,
  end: number,
  childNodeId?: string
): string {
  // Use position-based ID for stable DOM updates
  // Include childNodeId to differentiate selections for different children
  const childPart = childNodeId ? `-${childNodeId}` : '';
  return `marker-${blockId}-${start}-${end}${childPart}`;
}
