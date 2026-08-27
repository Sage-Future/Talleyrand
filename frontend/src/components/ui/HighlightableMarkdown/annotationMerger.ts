/**
 * Annotation merging logic to handle overlapping highlights.
 */

import type { Annotation, Segment } from './types';

/**
 * Merges overlapping annotations into non-overlapping segments.
 * Returns a map from blockId to segments.
 */
export function mergeOverlappingAnnotations(annotations: Annotation[]): Map<string, Segment[]> {
  // Filter out invalid annotations (null, undefined, or missing required properties)
  const validAnnotations = annotations.filter(
    ann => ann != null && ann.blockId != null && ann.type != null && ann.id != null
  );

  // Group annotations by blockId
  const byBlock = new Map<string, Annotation[]>();

  for (const annotation of validAnnotations) {
    const existing = byBlock.get(annotation.blockId) ?? [];
    existing.push(annotation);
    byBlock.set(annotation.blockId, existing);
  }

  // Merge segments for each block
  const result = new Map<string, Segment[]>();

  for (const [blockId, blockAnnotations] of byBlock.entries()) {
    result.set(blockId, mergeSegments(blockAnnotations));
  }

  return result;
}

/**
 * Merges overlapping annotations within a single block into non-overlapping segments.
 */
function mergeSegments(annotations: Annotation[]): Segment[] {
  if (annotations.length === 0) {
    return [];
  }

  // Collect all boundaries (start and end points)
  const boundaries = new Set<number>();

  for (const annotation of annotations) {
    boundaries.add(annotation.start);
    boundaries.add(annotation.end);
  }

  // Sort boundaries
  const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

  // Build segments between consecutive boundaries
  const segments: Segment[] = [];

  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const start = sortedBoundaries[i];
    const end = sortedBoundaries[i + 1];

    // Find which annotations are active in this segment
    const activeAnnotations = annotations.filter(ann => ann.start <= start && end <= ann.end);

    if (activeAnnotations.length > 0) {
      segments.push({
        start,
        end,
        annotationIds: activeAnnotations.map(ann => ann.id),
      });
    }
  }

  return segments;
}
