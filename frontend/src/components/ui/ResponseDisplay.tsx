/**
 * ResponseDisplay - Renders an answer as markdown with child-selection and
 * insight highlights, and reports user text selections for the select-to-ask popup.
 */

import { FC, useRef, useMemo, useState, useCallback } from 'react';
import type { Highlight, TextSelection } from '../../types';
import { HighlightableMarkdown } from './HighlightableMarkdown';
import { extractBlocks } from './HighlightableMarkdown/blockExtractor';
import { iconTooltip } from './TooltipLayer';
import {
  highlightsToAnnotations,
  selectionsToAnnotations,
} from './HighlightableMarkdown/selectionToAnnotation';

/**
 * Resolves a DOM Range boundary expressed on an element (offset = child index,
 * as produced by triple-click or drag-to-edge selections) to a concrete node
 * the block walk can anchor on. A boundary before a child becomes that child
 * (the walk stops before an element target without counting it); a boundary
 * after the last child descends to the last child's end. Text-node boundaries
 * pass through unchanged.
 */
function normalizeBoundary(node: Node, offset: number): { node: Node; offset: number } {
  while (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length > 0) {
    const children = node.childNodes;
    if (offset < children.length) {
      return { node: children[offset], offset: 0 };
    }
    node = children[children.length - 1];
    offset =
      node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length;
  }
  return { node, offset };
}

/** Nearest ancestor (or self) carrying a data-block-id, up to the container. */
function findBlockAncestor(node: Node, container: HTMLElement | null): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== container) {
    if (current instanceof HTMLElement && current.hasAttribute('data-block-id')) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * Walks the DOM tree within a block element and calculates the character offset
 * from the start of the block to the target node/offset, using the same character
 * counting as the HAST-based block extraction system.
 *
 * Elements whose rendered text differs from their markdown source (KaTeX math,
 * question-ref chips) declare the source length via data-source-length; that
 * declared length is counted instead of the rendered DOM textContent length.
 * A boundary falling inside such an element snaps outward — a selection start
 * counts none of the token, an end counts all of it — so a selection
 * overlapping the token annotates the whole token.
 */
function calculateBlockRelativeOffset(
  blockElement: HTMLElement,
  targetNode: Node,
  targetOffset: number,
  boundary: 'start' | 'end'
): number {
  // A normalized boundary resolving to the block element itself sits before
  // the block's content.
  if (targetNode === blockElement) return 0;

  let count = 0;
  let found = false;

  function walk(node: Node): void {
    if (found) return;

    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        count += targetOffset;
      }
      found = true;
      return;
    }

    if (node instanceof HTMLElement) {
      const sourceLen = node.getAttribute('data-source-length');
      if (sourceLen !== null) {
        if (node.contains(targetNode)) {
          if (boundary === 'end') {
            count += parseInt(sourceLen, 10);
          }
          found = true;
          return;
        }
        count += parseInt(sourceLen, 10);
        return;
      }
    }

    if (node.nodeType === Node.TEXT_NODE) {
      count += node.textContent?.length || 0;
      return;
    }

    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      walk(children[i]);
      if (found) return;
    }
  }

  const children = blockElement.childNodes;
  for (let i = 0; i < children.length; i++) {
    walk(children[i]);
    if (found) break;
  }

  return count;
}

interface ResponseDisplayProps {
  content: string;
  selections?: TextSelection[];
  highlights?: Highlight[];
  onSelectionChange: (
    selection: {
      text: string;
      rect: DOMRect | null;
      startOffset?: number;
      endOffset?: number;
      prefix?: string;
      suffix?: string;
    } | null
  ) => void;
  disableSelection?: boolean;
  fullHeight?: boolean;
}

export const ResponseDisplay: FC<ResponseDisplayProps> = ({
  content,
  selections = [],
  highlights = [],
  onSelectionChange,
  disableSelection = false,
  fullHeight = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Extract blocks from content
  const blocks = useMemo(() => {
    if (!content) return [];
    return extractBlocks(content);
  }, [content]);

  // Convert all child selections to annotations with a single stable kind.
  const childAnnotations = useMemo(
    () => selectionsToAnnotations(selections, blocks, 'child-selection'),
    [selections, blocks]
  );

  // Insight highlights the user marked with the lightbulb, rendered as a
  // distinct (yellow) mark, removable on click.
  const insightAnnotations = useMemo(
    () => highlightsToAnnotations(highlights, blocks),
    [highlights, blocks]
  );

  // Merge all annotations. The live selection is deliberately NOT rendered as
  // a mark: rewriting the selected DOM range would destroy the native browser
  // selection, and with it native copying while the popup is open.
  const allAnnotations = useMemo(
    () => [...childAnnotations, ...insightAnnotations],
    [childAnnotations, insightAnnotations]
  );

  const handleCopyContent = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1000);
    } catch (err) {
      console.error('Failed to copy content:', err);
    }
  };

  const handleMouseUp = useCallback(() => {
    // Disable selection when streaming
    if (disableSelection) {
      window.getSelection()?.removeAllRanges();
      return;
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString();

    if (selectedText && selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Map both range boundaries from the rendered DOM into the source
      // coordinate system (block texts joined by newlines, data-source-length
      // elements counted at their source length). Rendered text length is not
      // a valid measure for the end: a question-ref chip renders the target
      // question's text in place of its short [[id]] token, and KaTeX renders
      // MathML + HTML markup for a formula's LaTeX source.
      let startOffset: number | undefined;
      let endOffset: number | undefined;

      if (blocks.length > 0) {
        const startBoundary = normalizeBoundary(range.startContainer, range.startOffset);
        const endBoundary = normalizeBoundary(range.endContainer, range.endOffset);
        const startBlock = findBlockAncestor(startBoundary.node, containerRef.current);
        const endBlock = findBlockAncestor(endBoundary.node, containerRef.current);
        const startBlockId = startBlock?.getAttribute('data-block-id');
        const endBlockId = endBlock?.getAttribute('data-block-id');

        let startBlockEnd = 0;
        let globalOffset = 0;
        for (const block of blocks) {
          if (startBlock && block.blockId === startBlockId) {
            startOffset =
              globalOffset +
              calculateBlockRelativeOffset(
                startBlock,
                startBoundary.node,
                startBoundary.offset,
                'start'
              );
            startBlockEnd = globalOffset + block.text.length;
          }
          if (endBlock && block.blockId === endBlockId) {
            endOffset =
              globalOffset +
              calculateBlockRelativeOffset(endBlock, endBoundary.node, endBoundary.offset, 'end');
          }
          // Each block is followed by a newline separator in the cumulative offset
          globalOffset += block.text.length + 1;
        }

        if (startOffset === undefined) {
          // The start boundary has no anchored block (display math has no
          // block id) — there is no coordinate to store. The popup still
          // works from text/prefix/suffix; only the persistent underline
          // anchor is skipped.
          endOffset = undefined;
        } else if (endOffset === undefined) {
          // The end boundary sits in a block-less region, which only occurs
          // past the start block's content — the same place annotation
          // rendering clamps multi-block selections to.
          endOffset = startBlockEnd;
        }
      }

      // Extract prefix and suffix (100 chars each) directly from DOM ranges.
      // This avoids offset mismatches caused by rendered text (KaTeX math,
      // question-ref chips) differing from the annotation coordinate system.
      let prefix: string | undefined;
      let suffix: string | undefined;

      if (containerRef.current) {
        const prefixRange = document.createRange();
        prefixRange.selectNodeContents(containerRef.current);
        prefixRange.setEnd(range.startContainer, range.startOffset);
        const textBefore = prefixRange.toString();
        prefix = textBefore.slice(-100);
        prefixRange.detach();

        const suffixRange = document.createRange();
        suffixRange.selectNodeContents(containerRef.current);
        suffixRange.setStart(range.endContainer, range.endOffset);
        const textAfter = suffixRange.toString();
        suffix = textAfter.slice(0, 100);
        suffixRange.detach();
      }

      onSelectionChange({ text: selectedText, rect, startOffset, endOffset, prefix, suffix });
    } else {
      onSelectionChange(null);
    }
  }, [disableSelection, onSelectionChange, blocks]);

  return (
    <div className="relative">
      <div className="relative">
        <div
          ref={containerRef}
          className={`overflow-y-auto border border-gray-200 rounded p-4 bg-white ${
            fullHeight ? 'h-full' : 'min-h-[200px] max-h-[500px]'
          }`}
          onMouseUp={handleMouseUp}
        >
          <div
            className={`prose ${fullHeight ? 'prose-lg' : 'prose-sm'} max-w-none ${fullHeight ? 'text-base' : 'text-xs'} ${disableSelection ? 'select-none' : 'select-text'}`}
          >
            <HighlightableMarkdown content={content} annotations={allAnnotations} />
            {disableSelection && content && (
              <span className="inline-block w-2 h-4 bg-gray-600 animate-pulse ml-1" />
            )}
          </div>
        </div>
        <div className="absolute bottom-2 right-2 flex gap-1 pointer-events-none">
          <button
            onClick={handleCopyContent}
            className="p-0.5 bg-white/70 rounded hover:bg-white/90 transition-all pointer-events-auto"
            {...iconTooltip('Copy response')}
          >
            {copyFeedback ? (
              <img
                src="/check-icon.svg"
                alt="Copied"
                className="w-3 h-3 text-green-600"
                style={{
                  filter:
                    'invert(48%) sepia(79%) saturate(2476%) hue-rotate(86deg) brightness(100%) contrast(85%)',
                }}
              />
            ) : (
              <img
                src="/copy-icon.svg"
                alt="Copy"
                className="w-3 h-3 opacity-60 hover:opacity-100"
              />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
