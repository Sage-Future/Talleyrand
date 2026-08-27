/**
 * Rehype plugin to inject highlight marks into the HAST.
 */

import { visit, SKIP } from 'unist-util-visit';
import { toString as hastToString } from 'hast-util-to-string';
import type { Root as HastRoot, Element, ElementContent, Text } from 'hast';
import type { Annotation, Segment } from './types';

interface RehypeHighlightOptions {
  segmentsByBlock: Map<string, Segment[]>;
  annotationsById: Map<string, Annotation>;
}

/**
 * Rehype plugin that injects highlight marks for annotated text.
 */
export function rehypeHighlight(options: RehypeHighlightOptions) {
  const { segmentsByBlock, annotationsById } = options;

  return (tree: HastRoot) => {
    visit(tree, node => {
      // Find elements with data-block-id that have segments
      if (node.type === 'element' && node.properties && node.properties.dataBlockId) {
        const blockId = String(node.properties.dataBlockId);
        const segments = segmentsByBlock.get(blockId);

        if (segments && segments.length > 0) {
          // Inject highlights into this block element
          injectHighlightsIntoElement(node, segments, annotationsById);
          return SKIP; // Skip children since we already processed them
        }
      }
    });
  };
}

/**
 * Injects highlights into an element's text nodes.
 */
function injectHighlightsIntoElement(
  element: Element,
  segments: Segment[],
  annotationsById: Map<string, Annotation>
): void {
  let charPosition = 0;

  // Recursively process children
  const processNode = (node: ElementContent): ElementContent[] => {
    if (node.type === 'text') {
      const textStart = charPosition;
      const textEnd = charPosition + node.value.length;
      charPosition = textEnd;

      // Find overlapping segments
      const overlapping = segments.filter(seg => seg.start < textEnd && seg.end > textStart);

      if (overlapping.length === 0) {
        return [node];
      }

      // Split text based on segments
      return splitTextWithSegments(node as Text, textStart, overlapping, annotationsById);
    }

    if (node.type === 'element') {
      // Math code elements are atomic — don't recurse into them.
      // remark-math + remark-rehype produces <code class="math-inline"> / <code class="math-display">.
      // Splitting their text would break the KaTeX React component.
      // Instead, wrap the entire math element in a highlight mark if it overlaps with annotations.
      if (isMathCodeElement(node as Element)) {
        const mathStart = charPosition;
        const mathLen = hastToString(node as Element).length;
        const mathEnd = mathStart + mathLen;
        charPosition = mathEnd;

        const overlapping = segments.filter(seg => seg.start < mathEnd && seg.end > mathStart);
        if (overlapping.length > 0) {
          const annotations = overlapping[0].annotationIds
            .map(id => annotationsById.get(id))
            .filter((ann): ann is Annotation => ann !== undefined);

          return [
            {
              type: 'element',
              tagName: 'highlightMark',
              properties: {
                annotationIds: JSON.stringify(overlapping[0].annotationIds),
                annotationData: JSON.stringify(annotations),
                isMathElement: 'true',
              },
              children: [node as unknown as Element],
            } as Element,
          ];
        }

        return [node];
      }

      // Recursively process element's children
      const newChildren: ElementContent[] = [];
      for (const child of node.children) {
        newChildren.push(...processNode(child));
      }
      node.children = newChildren;
      return [node];
    }

    return [node];
  };

  // Process all children
  const newChildren: ElementContent[] = [];
  for (const child of element.children) {
    newChildren.push(...processNode(child));
  }
  element.children = newChildren;
}

/**
 * Splits a text node based on overlapping segments.
 */
function splitTextWithSegments(
  textNode: Text,
  textStart: number,
  segments: Segment[],
  annotationsById: Map<string, Annotation>
): ElementContent[] {
  const text = textNode.value;
  const textEnd = textStart + text.length;

  // Collect all split points within this text node
  const splitPoints = new Set<number>();
  splitPoints.add(textStart);
  splitPoints.add(textEnd);

  for (const segment of segments) {
    if (segment.start > textStart && segment.start < textEnd) {
      splitPoints.add(segment.start);
    }
    if (segment.end > textStart && segment.end < textEnd) {
      splitPoints.add(segment.end);
    }
  }

  const sortedPoints = Array.from(splitPoints).sort((a, b) => a - b);
  const result: ElementContent[] = [];

  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const start = sortedPoints[i];
    const end = sortedPoints[i + 1];
    const localStart = start - textStart;
    const localEnd = end - textStart;
    const subtext = text.slice(localStart, localEnd);

    // Find segments that cover this range
    const covering = segments.filter(seg => seg.start <= start && end <= seg.end);

    if (covering.length > 0) {
      // This part should be highlighted
      const annotations = covering[0].annotationIds
        .map(id => annotationsById.get(id))
        .filter((ann): ann is Annotation => ann !== undefined);

      result.push({
        type: 'element',
        tagName: 'highlightMark',
        properties: {
          annotationIds: JSON.stringify(covering[0].annotationIds),
          annotationData: JSON.stringify(annotations),
        },
        children: [{ type: 'text', value: subtext }],
      } as Element);
    } else {
      // Regular text
      result.push({
        type: 'text',
        value: subtext,
      });
    }
  }

  return result;
}

/**
 * Checks if an element is a math code element produced by remark-math + remark-rehype.
 * These have className containing 'math-inline' or 'math-display'.
 */
function isMathCodeElement(el: Element): boolean {
  if (el.tagName !== 'code') return false;
  const classes = Array.isArray(el.properties?.className) ? el.properties.className : [];
  return classes.some((c: string | number) => c === 'math-inline' || c === 'math-display');
}
